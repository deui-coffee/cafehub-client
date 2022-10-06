import { EventEmitter } from 'events'
import AbortError from '../errors/AbortError'
import SocketNotReadyError from '../errors/SocketNotReadyError'
import { ConnectOptions, WebSocketClientEvent, WebSocketClientState } from '../types'
import connectUtil from './connect'
import delay from './delay'

const ReconnectAfter = {
    Step: 250,
    Max: 10000,
}

export default class WebSocketClient {
    private readonly eventEmitter: EventEmitter = new EventEmitter()

    private ws: undefined | WebSocket

    private abortController: undefined | AbortController

    private state: WebSocketClientState = WebSocketClientState.Disconnected

    getState() {
        return this.state
    }

    private setState(state: WebSocketClientState) {
        if (this.state !== state) {
            this.state = state
            this.eventEmitter.emit(WebSocketClientEvent.StateChange, state)
        }
    }

    teardown() {
        this.ws?.removeEventListener('message', this.onMessage)

        this.ws?.removeEventListener('close', this.onClose)

        this.ws?.close()

        this.ws = undefined

        this.setState(WebSocketClientState.Disconnected)

        this.abortController?.abort()

        this.abortController = new AbortController()

        this.eventEmitter.emit(WebSocketClientEvent.Teardown)
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

        this.eventEmitter.emit(WebSocketClientEvent.Data, data)
    }

    private onClose = async (e: CloseEvent) => {
        this.eventEmitter.emit(WebSocketClientEvent.Disconnect, e)

        function isWs(target: unknown): target is WebSocket {
            return !!target
        }

        if (isWs(e.currentTarget)) {
            try {
                await this.connect(e.currentTarget.url, {
                    retry: true,
                })
            } catch (e) {
                this.setState(WebSocketClientState.Disconnected)
            }
        }
    }

    async connect(url: string, { retry = 0 }: ConnectOptions = {}) {
        this.teardown()

        this.setState(WebSocketClientState.Connecting)

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
                        this.eventEmitter.emit(WebSocketClientEvent.Error, e)
                    },
                })

                this.abortController = undefined

                this.ws = ws

                this.setState(WebSocketClientState.Connected)

                this.eventEmitter.emit(WebSocketClientEvent.Connect)

                ws.addEventListener('message', this.onMessage)

                ws.addEventListener('close', this.onClose)

                break
            } catch (e) {
                if (e instanceof AbortError) {
                    break
                }

                if (e instanceof CloseEvent) {
                    this.eventEmitter.emit(WebSocketClientEvent.Disconnect, e)

                    if (retry === true || (typeof retry === 'number' && retryCount < retry)) {
                        reanimateAfter = Math.min(
                            (reanimateAfter || 0) + ReconnectAfter.Step,
                            ReconnectAfter.Max
                        )

                        retryCount++

                        continue
                    }

                    this.setState(WebSocketClientState.Disconnected)
                }

                throw e
            }
        }
    }

    send(data: string) {
        if (!this.ws || this.getState() !== WebSocketClientState.Connected) {
            throw new SocketNotReadyError()
        }

        this.ws.send(data)
    }

    on(eventName: WebSocketClientEvent.Connect, listener: () => void): WebSocketClient

    on(
        eventName: WebSocketClientEvent.Data,
        listener: (data: Record<string, unknown>) => void
    ): WebSocketClient

    on(eventName: WebSocketClientEvent.Disconnect, listener: () => void): WebSocketClient

    on(eventName: WebSocketClientEvent.Error, listener: (error: Error) => void): WebSocketClient

    on(
        eventName: WebSocketClientEvent.StateChange,
        listener: (state: WebSocketClientState) => void
    ): WebSocketClient

    on(eventName: WebSocketClientEvent.Teardown, listener: () => void): WebSocketClient

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(eventName: WebSocketClientEvent, listener: (...args: any[]) => void) {
        this.eventEmitter.on(eventName, listener)

        return this
    }

    once(eventName: WebSocketClientEvent.Connect, listener: () => void): WebSocketClient

    once(
        eventName: WebSocketClientEvent.Data,
        listener: (data: Record<string, unknown>) => void
    ): WebSocketClient

    once(eventName: WebSocketClientEvent.Disconnect, listener: () => void): WebSocketClient

    once(eventName: WebSocketClientEvent.Error, listener: (error: Error) => void): WebSocketClient

    once(
        eventName: WebSocketClientEvent.StateChange,
        listener: (state: WebSocketClientState) => void
    ): WebSocketClient

    once(eventName: WebSocketClientEvent.Teardown, listener: () => void): WebSocketClient

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    once(eventName: WebSocketClientEvent, listener: (...args: any[]) => void) {
        this.eventEmitter.once(eventName, listener)

        return this
    }

    off(eventName: WebSocketClientEvent.Connect, listener: () => void): WebSocketClient

    off(
        eventName: WebSocketClientEvent.Data,
        listener: (data: Record<string, unknown>) => void
    ): WebSocketClient

    off(eventName: WebSocketClientEvent.Disconnect, listener: () => void): WebSocketClient

    off(eventName: WebSocketClientEvent.Error, listener: (error: Error) => void): WebSocketClient

    off(
        eventName: WebSocketClientEvent.StateChange,
        listener: (state: WebSocketClientState) => void
    ): WebSocketClient

    off(eventName: WebSocketClientEvent.Teardown, listener: () => void): WebSocketClient

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    off(eventName: WebSocketClientEvent, listener: (...args: any[]) => void) {
        this.eventEmitter.off(eventName, listener)

        return this
    }
}
