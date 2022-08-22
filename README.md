# cafehub-client

Custom WebSocket client for CafeHub.

## Connect to the backend

Let's say you have an instance of [`cafehub`](https://github.com/rheasman/cafehub) WebSocket server running on `ws://192.168.0.10:8765`. We can connect to it using `CafeHubClient#connect(url[, options])` method. Example:

```js
import CafeHubClient from 'cafehub-client'

const ch = new CafeHubClient()
​
async function connect() {
    await ch.connect('ws://192.168.0.10:8765', {
        retry: 3,
    })
}

connect()
```

## Connect to DE1

We can combine it with scanning and connecting to a DE1 machine.

```js
import CafeHubClient from 'cafehub-client'
import {
    Device,
    isScanResultUpdate,
    RequestCommand,
    UpdateMessage,
} from 'cafehub-client/types'

const ch = new CafeHubClient()

async function autoPair() {
    console.log('Connecting to cafehub…')

    await ch.connect('ws://192.168.0.10:8765', {
        retry: 3,
    })

    console.log('Looking for DE1…')

    const msg: UpdateMessage = await client.sendRequest(
        {
            command: RequestCommand.Scan,
            params: {
                Timeout: timeout,
            },
        },
        {
            resolveIf(msg) {
                if (!isScanResultUpdate(msg)) {
                    return false
                }

                return !msg.results.MAC || msg.results.Name === 'DE1'
            },
        }
    )

    if (!isScanResultUpdate(msg) || !msg.results.MAC) {
        throw new Error('DE1 was not found.')
    }

    console.log('Connecting cafehub to DE1…')

    const msg: UpdateMessage = yield client.sendRequest({
        command: RequestCommand.GATTConnect,
        params: {
            MAC: msg.results.MAC,
        },
    })

    console.log('Done.')
}

autoPair()
```

At this point we're ready to send other instructions to the CafeHub instance.

tbc.
