// Import necessary modules
import { Console } from '@fadroma/namada'
import { NODE_CONTROL_URL, PROXY_CONTROL_URL } from './config.js'
// Import ws WebSocket library for Node.js
import WebSocket from 'ws';

const console = new Console('')

/** Remote control for node and node-out proxy. */
export class RemoteControl {
  constructor ({
    chain,
    proxyApi = PROXY_CONTROL_URL,
    nodeApi  = NODE_CONTROL_URL,
  } = {}) {
    this.proxyApi = proxyApi
    const proxyWs = Object.assign(new URL(proxyApi), { protocol: 'wss:' }).href
    this.proxyWs  = new ReconnectingWebSocket(proxyWs)

    this.nodeApi = nodeApi
    const nodeWs = Object.assign(new URL(nodeApi), { protocol: 'wss:' }).href
    this.nodeWs  = new ReconnectingWebSocket(nodeWs)

    this.chain = chain
    this.chain.log.debug = () => {}
    this.chain.connections[0].log.debug = () => {}
  }

  async isPaused () {
    const response = await fetch(this.proxyApi)
    const json = await response.json()
    // console.log('isPaused response:', json)
    const status = json.canConnect
    return !status
  }

  async resume () {
    console.log('🟢 Sending resume sync command', this.proxyApi)
    ;(await this.proxyWs.socket).send(JSON.stringify({resume:{}}))
  }

  async restart () {
    console.log('🟠 Sending restart sync to', this.nodeApi)
    ;(await this.nodeWs.socket).send(JSON.stringify({restart:{}}))
    await this.resume()
  }
}

export class ReconnectingWebSocket {
  constructor (url) {
    this.url = url
  }

  connect (backoff = 0) {
    return this.socket = new Promise(async (resolve, reject) => {
      if (backoff > 0) {
        console.log('Waiting for', backoff, 'msec before connecting to socket...')
        await new Promise(resolve => setTimeout(resolve, backoff))
      }

      try {
        console.log('Connecting to', this.url)
        const socket = new WebSocket(this.url)

        const onConnectError = (error) => {
          console.error(`🔴 Error connecting to ${this.url}:`, error)
          reject(error)
        }

        socket.on('open', () => {
          console.log('Connected to', this.url)
          backoff = 0
          resolve(socket)
        })

        socket.on('error', onConnectError)

        socket.on('close', () => {
          console.log('Disconnected from', this.url, 'reconnecting...')
          this.socket = this.connect(backoff + 250)
        })

      } catch (e) {
        console.error(e)
        console.error('Failed to connect to', this.url, 'retrying in 1s')
        this.socket = this.connect(backoff + 250)
      }
    })
  }
}
