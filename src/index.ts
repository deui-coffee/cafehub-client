import {
    CafehubClientEvent,
    CafehubClientOptions,
    CafehubClientState,
    GATTNotifyUpdate,
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
}

interface SentMessages {
    [id: string]: PromiseSettlers
}

export default class CafehubClient {
    private readonly eventEmitter: EventEmitter

    private ws: undefined | WebSocket

    autoReconnect: boolean

    private lastRequestId: undefined | number

    private sentMessages: undefined | SentMessages

    private pendingMMRReads: undefined | object[]

    private reconnectionTimeoutId: undefined | number

    private lastKnownState = CafehubClientState.Disconnected

    constructor(
        readonly url: string,
        { autoReconnect = true, autoConnect = true }: CafehubClientOptions = {}
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

        if (this.sentMessages) {
            Object.values(this.sentMessages).forEach(({ reject }) => {
                reject(new Error('Abort'))
            })
        }

        if (this.reconnectionTimeoutId) {
            window.clearTimeout(this.reconnectionTimeoutId)
            this.reconnectionTimeoutId = undefined
        }

        this.reconnectionTimeoutId = undefined
        this.sentMessages = undefined
        this.lastRequestId = undefined
        this.pendingMMRReads = undefined
        this.ws = undefined
    }

    connect({ autoReconnectAfter = ReconnectAfter.Initial }: { autoReconnectAfter?: number } = {}) {
        if (
            this.getState() === CafehubClientState.Connected ||
            this.getState() === CafehubClientState.Connecting
        ) {
            return
        }

        this.teardown()

        this.ws = new WebSocket(this.url)

        this.ws.onopen = () => {
            console.info('onopen')

            this.eventEmitter.emit(CafehubClientEvent.Connect)
            this.touchState()
        }

        this.ws.onclose = (e: CloseEvent) => {
            console.info('onclose', e)

            this.eventEmitter.emit(CafehubClientEvent.Disconnect, e)
            this.touchState()

            if (this.autoReconnect) {
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
            console.info('onerror', e)

            this.eventEmitter.emit(CafehubClientEvent.Error, e)
            this.touchState()
        }

        function isIncomingMessage(data: undefined | object): data is UpdateMessage {
            return !!data && typeof data === 'object' && 'id' in data
        }

        function isGATTNotify(data: UpdateMessage): data is GATTNotifyUpdate {
            return data.type === MessageType.Update && data.update === UpdateType.GATTNotify
        }

        this.ws.onmessage = (e: MessageEvent<string>) => {
            console.info('onmessage', e)

            let data: undefined | object

            try {
                data = JSON.parse(e.data)
            } catch (e) {
                // Ignore.
            }

            if (!isIncomingMessage(data)) {
                return
            }

            if (data.id === 0) {
                if (!isGATTNotify(data)) {
                    return
                }

                this.eventEmitter.emit(CafehubClientEvent.CharChange, data)

                return
            }

            if (!this.sentMessages || !this.sentMessages[data.id]) {
                return
            }

            this.sentMessages[data.id].resolve(data)

            this.eventEmitter.emit(CafehubClientEvent.Data, data)
        }

        this.touchState()
    }

    getState() {
        switch (this.ws?.readyState) {
            case WebSocket.OPEN:
                return CafehubClientState.Connected
            case WebSocket.CONNECTING:
                return CafehubClientState.Connecting
            case WebSocket.CLOSING:
                return CafehubClientState.Disconnecting
            case WebSocket.CLOSED:
            default:
                return CafehubClientState.Disconnected
        }
    }

    on(eventName: string, listener: (...args: unknown[]) => void) {
        this.eventEmitter.on(eventName, listener)

        return this
    }

    once(eventName: string, listener: (...args: unknown[]) => void) {
        this.eventEmitter.once(eventName, listener)

        return this
    }

    off(eventName: string, listener: (...args: unknown[]) => void) {
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

        this.eventEmitter.emit(CafehubClientEvent.StateChange)
    }

    async send(
        request: Request,
        { timeout, quiet = false }: { timeout?: number; quiet?: boolean } = {}
    ) {
        if (!this.ws || this.getState() !== CafehubClientState.Connected) {
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
                //
            },
            reject() {
                //
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

        if (!this.sentMessages) {
            this.sentMessages = {}
        }

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
            if (this.sentMessages) {
                delete this.sentMessages[payload.id]
            }
        }

        return payload
    }
}
