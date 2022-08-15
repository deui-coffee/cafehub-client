import {
    CafeHubClientEvent,
    CafeHubClientOptions,
    CafeHubClientState,
    ConnectionState,
    Device,
    GATTNotifyUpdate,
    isGATTNotifyUpdate,
    isScanResultUpdate,
    isUpdateMessage,
    MessageType,
    Request,
    RequestMessage,
    UpdateMessage,
    UpdateType,
} from './types'
import { EventEmitter } from 'events'

const MaxRequestId = 1000000000

const ReconnectAfter = {
    Initial: 0,
    Step: 250,
    Max: 10000,
}

interface PromiseSettlers {
    resolve: (message: UpdateMessage) => void
    reject: (reason?: unknown) => void
    onUpdate: (message: UpdateMessage) => boolean
}

interface SentMessages {
    [id: string]: PromiseSettlers
}

export default class CafeHubClient {
    private readonly eventEmitter: EventEmitter

    private ws: undefined | WebSocket

    autoReconnect: boolean

    private lastRequestId: undefined | number

    private sentMessages: SentMessages = {}

    private pendingMMRReads: undefined | object[]

    private reconnectionTimeoutId: undefined | number

    private lastKnownState = CafeHubClientState.Disconnected

    constructor(
        readonly url: string,
        { autoReconnect = true, autoConnect = true }: CafeHubClientOptions = {}
    ) {
        this.eventEmitter = new EventEmitter()
        this.autoReconnect = autoReconnect

        if (autoConnect) {
            this.connect()
        }
    }

    teardown() {
        if (this.ws) {
            this.ws.onopen = null
            this.ws.onmessage = null
            this.ws.onerror = null
            this.ws.onclose = null
        }

        Object.values(this.sentMessages).forEach(({ reject }) => {
            reject(new Error('Abort'))
        })

        if (this.reconnectionTimeoutId) {
            window.clearTimeout(this.reconnectionTimeoutId)
            this.reconnectionTimeoutId = undefined
        }

        this.reconnectionTimeoutId = undefined
        this.sentMessages = {}
        this.lastRequestId = undefined
        this.pendingMMRReads = undefined
        this.ws = undefined
    }

    connect({ autoReconnectAfter = ReconnectAfter.Initial }: { autoReconnectAfter?: number } = {}) {
        if (
            this.getState() === CafeHubClientState.Connected ||
            this.getState() === CafeHubClientState.Connecting
        ) {
            return
        }

        this.teardown()

        this.ws = new WebSocket(this.url)

        this.ws.onopen = () => {
            this.eventEmitter.emit(CafeHubClientEvent.Connect)
            this.touchState()
        }

        this.ws.onclose = (e: CloseEvent) => {
            this.eventEmitter.emit(CafeHubClientEvent.Disconnect, e)
            this.touchState()

            if (this.autoReconnect) {
                console.info(`Reconnecting in ${autoReconnectAfter}ms…`)

                this.reconnectionTimeoutId = window.setTimeout(() => {
                    this.connect({
                        autoReconnectAfter: Math.min(
                            autoReconnectAfter + ReconnectAfter.Step,
                            ReconnectAfter.Max
                        ),
                    })
                }, autoReconnectAfter)
            }
        }

        this.ws.onerror = (e: Event) => {
            this.eventEmitter.emit(CafeHubClientEvent.Error, e)
            this.touchState()
        }

        this.ws.onmessage = (e: MessageEvent<string>) => {
            let data: undefined | object

            try {
                data = JSON.parse(e.data)
            } catch (e) {
                // Ignore.
            }

            if (!isUpdateMessage(data)) {
                return
            }

            if (data.id === 0) {
                if (!isGATTNotifyUpdate(data)) {
                    return
                }

                this.eventEmitter.emit(CafeHubClientEvent.CharChange, data)

                return
            }

            if (!this.sentMessages[data.id]) {
                return
            }

            const { resolve, onUpdate } = this.sentMessages[data.id]

            if (onUpdate(data)) {
                resolve(data)
            }

            this.eventEmitter.emit(CafeHubClientEvent.UpdateMessage, data)

            if (isScanResultUpdate(data) && data.results.MAC) {
                this.eventEmitter.emit(CafeHubClientEvent.DeviceFound, {
                    ...data.results,
                    connectionState: ConnectionState.Disconnected,
                })
            }
        }

        this.touchState()
    }

    getState() {
        switch (this.ws?.readyState) {
            case WebSocket.OPEN:
                return CafeHubClientState.Connected
            case WebSocket.CONNECTING:
                return CafeHubClientState.Connecting
            case WebSocket.CLOSING:
                return CafeHubClientState.Disconnecting
            case WebSocket.CLOSED:
            default:
                return CafeHubClientState.Disconnected
        }
    }

    on(eventName: CafeHubClientEvent.DeviceFound, listener: (device: Device) => void): CafeHubClient

    on(
        eventName: CafeHubClientEvent.UpdateMessage,
        listener: (message: UpdateMessage) => void
    ): CafeHubClient

    on(
        eventName: CafeHubClientEvent.StateChange,
        listener: (state: CafeHubClientState) => void
    ): CafeHubClient

    on(eventName: string | CafeHubClientEvent, listener: (...args: any[]) => void): CafeHubClient {
        this.eventEmitter.on(eventName, listener)

        return this
    }

    once(eventName: string | CafeHubClientEvent, listener: (...args: any[]) => void) {
        this.eventEmitter.once(eventName, listener)

        return this
    }

    off(eventName: string | CafeHubClientEvent, listener: (...args: any[]) => void) {
        this.eventEmitter.off(eventName, listener)

        return this
    }

    private nextRequestId(): number {
        if (typeof this.lastRequestId === 'undefined') {
            this.lastRequestId = 0
        }

        this.lastRequestId = Math.max(1, (this.lastRequestId + 1) % MaxRequestId)

        return this.lastRequestId
    }

    private touchState() {
        const currentState = this.getState()

        if (currentState === this.lastKnownState) {
            return
        }

        this.lastKnownState = currentState

        this.eventEmitter.emit(CafeHubClientEvent.StateChange, currentState)
    }

    async send(
        request: Request,
        {
            timeout,
            quiet = false,
            onUpdate,
        }: {
            timeout?: number
            quiet?: boolean
            onUpdate?: (message: UpdateMessage) => boolean
        } = {}
    ) {
        if (!this.ws || this.getState() !== CafeHubClientState.Connected) {
            console.warn('Message skipped. WebSocket not connected.', request)
            return
        }

        const payload: RequestMessage = {
            ...request,
            id: this.nextRequestId(),
            type: MessageType.Request,
        }

        const promiseSettlers: PromiseSettlers = {
            resolve() {
                throw new Error('Failed to overwrite `resolve`')
            },
            reject() {
                throw new Error('Failed to overwrite `reject`')
            },
            onUpdate(message: UpdateMessage) {
                return (
                    message.id === payload.id &&
                    (typeof onUpdate !== 'function' || onUpdate(message))
                )
            },
        }

        let promise: undefined | Promise<UpdateMessage>

        await new Promise(
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            (done: (_?: unknown) => void, _: () => void) => {
                promise = new Promise((resolve: (message: UpdateMessage) => void, reject) => {
                    Object.assign(promiseSettlers, {
                        resolve,
                        reject,
                    })

                    // At this point we're sure that both `promise` & `promiseSettlers` are
                    // set correctly.
                    done()
                })
            }
        )

        Object.assign(this.sentMessages, {
            [payload.id]: promiseSettlers,
        })

        this.ws.send(JSON.stringify(payload))

        if (!promise) {
            throw new Error('Unexpected things happen all the time.')
        }

        try {
            if (typeof timeout === 'undefined') {
                await promise
            } else {
                await Promise.race([
                    promise,
                    new Promise((_, reject) =>
                        setTimeout(() => {
                            reject(new Error('Timeout'))
                        }, Math.max(0, timeout))
                    ),
                ])
            }
        } catch (e) {
            if (!quiet) {
                throw e
            }
        } finally {
            delete this.sentMessages[payload.id]
        }

        return payload
    }
}
