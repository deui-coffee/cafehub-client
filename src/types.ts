type Base64String = string

export enum RequestCommand {
    Scan = 'Scan',
    GATTConnect = 'GATTConnect',
    GATTDisconnect = 'GATTDisconnect',
    GATTRead = 'GATTRead',
    GATTSetNotify = 'GATTSetNotify',
    GATTWrite = 'GATTWrite',
}

export enum MessageType {
    Request = 'REQ',
    Response = 'RESP',
    Update = 'UPDATE',
}

export interface Message {
    id: number
    type: MessageType
}

export enum UpdateType {
    ScanResult = 'ScanResult',
    GATTNotify = 'GATTNotify',
    ConnectionState = 'ConnectionState',
    ExecutionError = 'ExecutionError',
}

export enum ConnectionState {
    Init = 'INIT',
    Disconnected = 'DISCONNECTED',
    Connected = 'CONNECTED',
    Cancelled = 'CANCELLED',
}

export interface UpdateMessage<T = unknown, R = unknown> extends Message {
    type: MessageType.Update
    update: T
    results: R
}

type ScanResultUpdate = UpdateMessage<
    UpdateType.ScanResult,
    {
        MAC: string
        Name: string
        UUIDs: [string]
    }
>

export type GATTNotifyUpdate = UpdateMessage<
    UpdateType.GATTNotify,
    {
        MAC: string
        Char: string
        Data: Base64String
    }
>

type ConnectionStateUpdate = UpdateMessage<
    UpdateType.ConnectionState,
    {
        MAC: string
        CState: ConnectionState
        UUIDs: [string]
    }
>

interface ResponseError {
    eid: number
    errmsg: string
}

type ErrorUpdate = UpdateMessage<UpdateType.ExecutionError, ResponseError>

export type Update = ScanResultUpdate | GATTNotifyUpdate | ConnectionStateUpdate | ErrorUpdate

export interface ResponseMessage<T = unknown> extends Message {
    type: MessageType.Response
    error: ResponseError
    results: T
}

interface GATTReadResult {
    Data: Base64String
}

export type GATTReadResponse = ResponseMessage<GATTReadResult>

interface Req<C, P> {
    command: C
    params: P
}

type ScanRequest = Req<
    RequestCommand.Scan,
    {
        Timeout: number
    }
>

type GATTConnectRequest = Req<
    RequestCommand.GATTConnect,
    {
        MAC: string
    }
>

type GATTDisconnectRequest = Req<
    RequestCommand.GATTDisconnect,
    {
        MAC: string
    }
>

type GATTReadRequest = Req<RequestCommand.GATTRead, Record<string, unknown>>

type GATTWriteRequest = Req<
    RequestCommand.GATTWrite,
    {
        MAC: string
        Char: string
        Data: ArrayBufferLike
        RR: boolean
    }
>

type GATTSetNotifyRequest = Req<
    RequestCommand.GATTSetNotify,
    {
        MAC: string
        Char: string
        Enable: boolean
    }
>

export type Request =
    | GATTConnectRequest
    | GATTDisconnectRequest
    | GATTReadRequest
    | GATTSetNotifyRequest
    | GATTWriteRequest
    | ScanRequest

export interface RequestMessage<P = unknown> extends Message {
    command: RequestCommand
    params: P
}

export enum CafehubClientEvent {
    Connect = 'CONNECT',
    Data = 'DATA',
    DeviceFound = 'DEVICE_FOUND',
    Disconnect = 'DISCONNECT',
    Error = 'ERROR',
    CharChange = 'CHAR_CHANGE',
    StateChange = 'STATE_CHANGE',
}

export enum CafehubClientState {
    Disconnected = WebSocket.CLOSED,
    Connecting = WebSocket.CONNECTING,
    Connected = WebSocket.OPEN,
    Disconnecting = WebSocket.CLOSING,
}

export interface CafehubClientOptions {
    autoConnect?: boolean
    autoReconnect?: boolean
}

export enum CharAddr {
    Versions /*       */ = '0000a001-0000-1000-8000-00805f9b34fb', // A R    Versions See T_Versions
    RequestedState /* */ = '0000a002-0000-1000-8000-00805f9b34fb', // B RW   RequestedState See T_RequestedState
    SetTime /*        */ = '0000a003-0000-1000-8000-00805f9b34fb', // C RW   SetTime Set current time
    ShotDirectory /*  */ = '0000a004-0000-1000-8000-00805f9b34fb', // D R    ShotDirectory View shot directory
    ReadFromMMR /*    */ = '0000a005-0000-1000-8000-00805f9b34fb', // E RW   ReadFromMMR Read bytes from data mapped into the memory mapped region.
    WriteToMMR /*     */ = '0000a006-0000-1000-8000-00805f9b34fb', // F W    WriteToMMR Write bytes to memory mapped region
    ShotMapRequest /* */ = '0000a007-0000-1000-8000-00805f9b34fb', // G W    ShotMapRequest Map a shot so that it may be read/written
    DeleteShotRange /**/ = '0000a008-0000-1000-8000-00805f9b34fb', // H W    DeleteShotRange Delete l shots in the range given
    FWMapRequest /*   */ = '0000a009-0000-1000-8000-00805f9b34fb', // I W    FWMapRequest Map a firmware image into MMR. Cannot be done with the boot image
    Temperatures /*   */ = '0000a00a-0000-1000-8000-00805f9b34fb', // J R    Temperatures See T_Temperatures
    ShotSettings /*   */ = '0000a00b-0000-1000-8000-00805f9b34fb', // K RW   ShotSettings See T_ShotSettings
    Deprecated /*     */ = '0000a00c-0000-1000-8000-00805f9b34fb', // L RW   Deprecated Was T_ShotDesc. Now deprecated.
    ShotSample /*     */ = '0000a00d-0000-1000-8000-00805f9b34fb', // M R    ShotSample Use to monitor a running shot. See T_ShotSample
    StateInfo /*      */ = '0000a00e-0000-1000-8000-00805f9b34fb', // N R    StateInfo The current state of the DE1
    HeaderWrite /*    */ = '0000a00f-0000-1000-8000-00805f9b34fb', // O RW   HeaderWrite Use this to change a header in the current shot description
    FrameWrite /*     */ = '0000a010-0000-1000-8000-00805f9b34fb', // P RW   FrameWrite Use this to change a single frame in the current shot description
    WaterLevels /*    */ = '0000a011-0000-1000-8000-00805f9b34fb', // Q RW   WaterLevels Use this to adjust and read water level settings
    Calibration /*    */ = '0000a012-0000-1000-8000-00805f9b34fb', // R RW   Calibration Use this to adjust and read calibration
}
