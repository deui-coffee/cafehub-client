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
} from './types'
import defer from './utils/defer'
import delay from './utils/delay'
import WebSocketClient from './utils/WebSocketClient'

const MaxRequestId = 1000000000

export default class CafeHubClient {
    private lastRequestId: undefined | number

    eventEmitter = new EventEmitter()

    wsc: WebSocketClient

    requests: Requests = {}

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

            return void this.eventEmitter.emit(CafeHubEvent.CharChange, msg)
        }

        if (!this.requests[msg.id]) {
            // We don't have a record of sending a message with this `id`.
            return
        }

        // *Try* to resolve associated `send` promise. Possibly a noop, see `resolveIf`.
        this.requests[msg.id].resolve(msg)

        this.eventEmitter.emit(CafeHubEvent.UpdateMessage, msg)

        if (isScanResultUpdate(msg) && msg.results.MAC) {
            this.eventEmitter.emit(CafeHubEvent.DeviceFound, {
                ...msg.results,
                connectionState: ConnectionState.Disconnected,
            })
        }
    }

    constructor() {
        this.wsc = new WebSocketClient()

        this.wsc.on(WebSocketClientEvent.Teardown, this.onTeardown)

        this.wsc.on(WebSocketClientEvent.Data, this.onData)
    }

    async connect(url: string, { retry = 0 }: ConnectOptions = {}) {
        return this.wsc.connect(url, { retry })
    }

    private nextRequestId(): number {
        this.lastRequestId = Math.max(1, ((this.lastRequestId || 0) + 1) % MaxRequestId)

        return this.lastRequestId
    }

    async send(request: Request, { timeout, quiet = false, resolveIf }: SendOptions = {}) {
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
            this.wsc.send(JSON.stringify(payload))
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
}
