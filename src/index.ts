import { EventEmitter } from 'events'
import AbortError from './errors/AbortError'
import {
    CafeHubEvent,
    ConnectionState,
    ConnectOptions,
    Defer,
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
    WebSocketClientEvent,
    WebSocketClientState,
} from './types'
import defer from './utils/defer'
import delay from './utils/delay'
import WebSocketClient from './utils/WebSocketClient'

const MaxRequestId = 1000000000

export default class CafeHubClient extends WebSocketClient {
    private lastRequestId: undefined | number

    private requests: Requests = {}

    onTeardown = () => {
        // Skip all remaining requests.
        Object.keys(this.requests).forEach(
            (key) => void this.requests[key].reject(new AbortError())
        )

        this.requests = {}
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

        this.on(WebSocketClientEvent.Data, this.onData)

        this.on(WebSocketClientEvent.Teardown, this.onTeardown)
    }

    private nextRequestId(): number {
        this.lastRequestId = Math.max(1, ((this.lastRequestId || 0) + 1) % MaxRequestId)

        return this.lastRequestId
    }

    async sendRequest(request: Request, { timeout, quiet = false, resolveIf }: SendOptions = {}) {
        const payload: RequestMessage = {
            ...request,
            id: this.nextRequestId(),
            type: MessageType.Request,
        }

        const { resolve, reject, promise } = await defer()

        const settlers: Defer = {
            resolve(msg: UpdateMessage) {
                if (msg.id !== payload.id) {
                    return
                }

                if (typeof resolveIf === 'function') {
                    if (resolveIf(msg)) {
                        resolve()
                    }

                    return
                }

                resolve()
            },
            reject,
        }

        Object.assign(this.requests, {
            [payload.id]: settlers,
        })

        try {
            this.send(JSON.stringify(payload))
        } catch (e) {
            settlers.reject(e)
        }

        if (!promise) {
            throw new Error('The impossible happened, yikes!')
        }

        try {
            if (!timeout) {
                await promise
            } else {
                await Promise.race([promise, delay(Math.max(0, timeout))])
            }
        } catch (e) {
            if (!quiet) {
                throw e
            }
        } finally {
            delete this.requests[payload.id]
        }

        return payload
    }

    on(eventName: WebSocketClientEvent.Connect, listener: () => void): this

    on(
        eventName: WebSocketClientEvent.Data,
        listener: (data: Record<string, unknown>) => void
    ): this

    on(eventName: WebSocketClientEvent.Disconnect, listener: () => void): this

    on(eventName: WebSocketClientEvent.Error, listener: (error: Error) => void): this

    on(
        eventName: WebSocketClientEvent.StateChange,
        listener: (state: WebSocketClientState) => void
    ): this

    on(eventName: WebSocketClientEvent.Teardown, listener: () => void): this

    on(eventName: string, listener: (...args: any[]) => void) {
        return super.on(eventName, listener)
    }

    once(eventName: WebSocketClientEvent.Connect, listener: () => void): this

    once(
        eventName: WebSocketClientEvent.Data,
        listener: (data: Record<string, unknown>) => void
    ): this

    once(eventName: WebSocketClientEvent.Disconnect, listener: () => void): this

    once(eventName: WebSocketClientEvent.Error, listener: (error: Error) => void): this

    once(
        eventName: WebSocketClientEvent.StateChange,
        listener: (state: WebSocketClientState) => void
    ): this

    once(eventName: WebSocketClientEvent.Teardown, listener: () => void): this

    once(eventName: string, listener: (...args: any[]) => void) {
        return super.once(eventName, listener)
    }

    off(eventName: WebSocketClientEvent.Connect, listener: () => void): this

    off(
        eventName: WebSocketClientEvent.Data,
        listener: (data: Record<string, unknown>) => void
    ): this

    off(eventName: WebSocketClientEvent.Disconnect, listener: () => void): this

    off(eventName: WebSocketClientEvent.Error, listener: (error: Error) => void): this

    off(
        eventName: WebSocketClientEvent.StateChange,
        listener: (state: WebSocketClientState) => void
    ): this

    off(eventName: WebSocketClientEvent.Teardown, listener: () => void): this

    off(eventName: string, listener: (...args: any[]) => void) {
        return super.off(eventName, listener)
    }
}
