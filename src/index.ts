import { EventEmitter } from 'events'
import AbortError from './errors/AbortError'
import {
    CafeHubEvent,
    CafeHubState,
    ConnectionState,
    ConnectOptions,
    Defer,
    Device,
    GATTNotifyUpdate,
    isGATTNotifyUpdate,
    isScanResultUpdate,
    isUpdateMessage,
    MessageType,
    RawMessage,
    Request,
    RequestMessage,
    Requests,
    SendOptions,
    UpdateMessage,
} from './types'
import defer from './utils/defer'
import delay from './utils/delay'
import connectUtil from './utils/connect'
import SocketNotReadyError from './errors/SocketNotReadyError'
import TimeoutError from './errors/TimeoutError'

const MaxRequestId = 1000000000

const ReconnectAfter = {
    Step: 250,
    Max: 10000,
}

export default class CafeHubClient extends EventEmitter {
    private lastRequestId: undefined | number

    private requests: Requests = {}

    private ws: undefined | WebSocket

    private abortController: undefined | AbortController

    private state: CafeHubState = CafeHubState.Disconnected

    getState() {
        return this.state
    }

    private setState(state: CafeHubState) {
        if (this.state !== state) {
            this.state = state
            this.emit(CafeHubEvent.StateChange, state)
        }
    }

    teardown() {
        this.ws?.removeEventListener('message', this.onMessage)

        this.ws?.removeEventListener('close', this.onClose)

        this.ws?.close()

        this.ws = undefined

        this.setState(CafeHubState.Disconnected)

        this.abortController?.abort()

        this.abortController = new AbortController()

        // Skip all remaining requests.
        Object.keys(this.requests).forEach(
            (key) => void this.requests[key].reject(new AbortError())
        )

        this.requests = {}

        this.emit(CafeHubEvent.Teardown)
    }

    private onMessage = (e: MessageEvent<string>) => {
        let data: undefined | Record<string, unknown>

        try {
            data = JSON.parse(e.data)

            if (data !== Object(data)) {
                // Filter out primitives.
                return
            }
        } catch (e) {
            return
        }

        this.emit(CafeHubEvent.Data, data)
    }

    private onClose = async (e: CloseEvent) => {
        this.emit(CafeHubEvent.Disconnect, e)

        this.teardown()

        if (e.currentTarget instanceof WebSocket) {
            try {
                await this.connect(e.currentTarget.url, {
                    retry: true,
                })
            } catch (e) {
                this.setState(CafeHubState.Disconnected)
            }
        }
    }

    async connect(url: string, { retry = 0 }: ConnectOptions = {}) {
        this.teardown()

        this.setState(CafeHubState.Connecting)

        let ws: WebSocket

        let reanimateAfter: undefined | number

        let retryCount = 0

        // eslint-disable-next-line no-constant-condition
        while (true) {
            try {
                if (typeof reanimateAfter === 'number') {
                    console.info(`Reconnecting in ${reanimateAfter}ms…`)

                    await delay(reanimateAfter, { abortSignal: this.abortController?.signal })
                }

                ws = await connectUtil(url, {
                    abortSignal: this.abortController?.signal,
                    onError: (e: Event) => {
                        this.emit(CafeHubEvent.Error, e)
                    },
                })

                // We're connected. AbortController is no longer needed.
                this.abortController = undefined

                this.ws = ws

                this.setState(CafeHubState.Connected)

                this.emit(CafeHubEvent.Connect)

                ws.addEventListener('message', this.onMessage)

                ws.addEventListener('close', this.onClose)

                break
            } catch (e) {
                if (e instanceof AbortError) {
                    break
                }

                if (e instanceof CloseEvent) {
                    this.emit(CafeHubEvent.Disconnect, e)

                    if (retry === true || (typeof retry === 'number' && retryCount < retry)) {
                        reanimateAfter = Math.min(
                            (reanimateAfter || 0) + ReconnectAfter.Step,
                            ReconnectAfter.Max
                        )

                        retryCount++

                        continue
                    }

                    this.setState(CafeHubState.Disconnected)
                }

                throw e
            }
        }
    }

    send(data: string) {
        if (!this.ws || this.getState() !== CafeHubState.Connected) {
            throw new SocketNotReadyError()
        }

        this.ws.send(data)
    }

    onData = (msg: RawMessage) => {
        if (!isUpdateMessage(msg)) {
            return
        }

        if (msg.id === 0) {
            if (!isGATTNotifyUpdate(msg)) {
                return
            }

            return void this.emit(CafeHubEvent.CharChange, msg)
        }

        if (!this.requests[msg.id]) {
            // We don't have a record of sending a message with this `id`.
            return
        }

        // *Try* to resolve associated `sendRequest` promise. Possibly a noop, see `resolveIf`.
        this.requests[msg.id].resolve(msg)

        this.emit(CafeHubEvent.UpdateMessage, msg)

        if (isScanResultUpdate(msg) && msg.results.MAC) {
            this.emit(CafeHubEvent.DeviceFound, {
                ...msg.results,
                connectionState: ConnectionState.Disconnected,
            })
        }
    }

    constructor() {
        super()

        this.on(CafeHubEvent.Data, this.onData)
    }

    private nextRequestId(): number {
        this.lastRequestId = Math.max(1, ((this.lastRequestId || 0) + 1) % MaxRequestId)

        return this.lastRequestId
    }

    async sendRequest(request: Request, { timeout, resolveIf }: SendOptions = {}) {
        const payload: RequestMessage = {
            ...request,
            id: this.nextRequestId(),
            type: MessageType.Request,
        }

        const { resolve, reject, promise } = await defer<UpdateMessage>()

        const settlers: Defer = {
            resolve(msg: UpdateMessage) {
                if (msg.id !== payload.id) {
                    return
                }

                if (typeof resolveIf === 'function') {
                    if (resolveIf(msg)) {
                        resolve(msg)
                    }

                    return
                }

                resolve(msg)
            },
            reject,
        }

        Object.assign(this.requests, {
            [payload.id]: settlers,
        })

        try {
            // If the client isn't ready this will throw.
            this.send(JSON.stringify(payload))

            if (!timeout) {
                return await promise
            } else {
                return await Promise.race([
                    promise,
                    delay(Math.max(0, timeout)).then(() => {
                        throw new TimeoutError()
                    }),
                ])
            }
        } catch (e) {
            settlers.reject(e)
        } finally {
            delete this.requests[payload.id]
        }
    }

    on(eventName: CafeHubEvent.CharChange, listener: (message: GATTNotifyUpdate) => void): this

    on(eventName: CafeHubEvent.Connect, listener: () => void): this

    on(eventName: CafeHubEvent.Data, listener: (data: Record<string, unknown>) => void): this

    on(eventName: CafeHubEvent.DeviceFound, listener: (device: Device) => void): this

    on(eventName: CafeHubEvent.Disconnect, listener: () => void): this

    on(eventName: CafeHubEvent.Error, listener: (error: Error) => void): this

    on(eventName: CafeHubEvent.StateChange, listener: (state: CafeHubState) => void): this

    on(eventName: CafeHubEvent.Teardown, listener: () => void): this

    on(eventName: CafeHubEvent.UpdateMessage, listener: (message: UpdateMessage) => void): this

    on(eventName: string, listener: (...args: any[]) => void) {
        return super.on(eventName, listener)
    }

    once(eventName: CafeHubEvent.CharChange, listener: (message: GATTNotifyUpdate) => void): this

    once(eventName: CafeHubEvent.Connect, listener: () => void): this

    once(eventName: CafeHubEvent.Data, listener: (data: Record<string, unknown>) => void): this

    once(eventName: CafeHubEvent.DeviceFound, listener: (device: Device) => void): this

    once(eventName: CafeHubEvent.Disconnect, listener: () => void): this

    once(eventName: CafeHubEvent.Error, listener: (error: Error) => void): this

    once(eventName: CafeHubEvent.StateChange, listener: (state: CafeHubState) => void): this

    once(eventName: CafeHubEvent.Teardown, listener: () => void): this

    once(eventName: CafeHubEvent.UpdateMessage, listener: (message: UpdateMessage) => void): this

    once(eventName: string, listener: (...args: any[]) => void) {
        return super.once(eventName, listener)
    }

    off(eventName: CafeHubEvent.CharChange, listener: (message: GATTNotifyUpdate) => void): this

    off(eventName: CafeHubEvent.Connect, listener: () => void): this

    off(eventName: CafeHubEvent.Data, listener: (data: Record<string, unknown>) => void): this

    off(eventName: CafeHubEvent.DeviceFound, listener: (device: Device) => void): this

    off(eventName: CafeHubEvent.Disconnect, listener: () => void): this

    off(eventName: CafeHubEvent.Error, listener: (error: Error) => void): this

    off(eventName: CafeHubEvent.StateChange, listener: (state: CafeHubState) => void): this

    off(eventName: CafeHubEvent.Teardown, listener: () => void): this

    off(eventName: CafeHubEvent.UpdateMessage, listener: (message: UpdateMessage) => void): this

    off(eventName: string, listener: (...args: any[]) => void) {
        return super.off(eventName, listener)
    }
}
