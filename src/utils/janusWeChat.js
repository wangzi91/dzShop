/* eslint-disable */
/*
	The MIT License (MIT)

	Copyright (c) 2016 Meetecho

	Permission is hereby granted, free of charge, to any person obtaining
	a copy of this software and associated documentation files (the "Software"),
	to deal in the Software without restriction, including without limitation
	the rights to use, copy, modify, merge, publish, distribute, sublicense,
	and/or sell copies of the Software, and to permit persons to whom the
	Software is furnished to do so, subject to the following conditions:

	The above copyright notice and this permission notice shall be included
	in all copies or substantial portions of the Software.

	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
	OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
	THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR
	OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
	ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
	OTHER DEALINGS IN THE SOFTWARE.
 */

// List of sessions
Janus.sessions = {}

Janus.useDefaultDependencies = function (deps) {
  var socketCls = (deps && deps.WebSocket) || WebSocket
  return {
    newWebSocket: function (server, proto) {
      return new socketCls(server, proto)
    },
    isArray: function (arr) {
      return Array.isArray(arr)
    },
  }
}

Janus.noop = function () {
}

Janus.dataChanDefaultLabel = 'JanusDataChannel'

// Initialization
Janus.init = function (options) {
  options = options || {}
  options.callback = (typeof options.callback == 'function') ? options.callback : Janus.noop
  if (Janus.initDone === true) {
    // Already initialized
    options.callback()
  } else {
    if (typeof console == 'undefined' || typeof console.log == 'undefined') {
      console = {
        log: function () {
        }
      }
    }
    // Console logging (all debugging disabled by default)
    Janus.trace = Janus.noop
    Janus.debug = Janus.noop
    Janus.vdebug = Janus.noop
    Janus.log = Janus.noop
    Janus.warn = Janus.noop
    Janus.error = Janus.noop
    if (options.debug === true || options.debug === 'all') {
      // Enable all debugging levels
      Janus.trace = console.trace.bind(console)
      Janus.debug = console.debug.bind(console)
      Janus.vdebug = console.debug.bind(console)
      Janus.log = console.log.bind(console)
      Janus.warn = console.warn.bind(console)
      Janus.error = console.error.bind(console)
    } else if (Array.isArray(options.debug)) {
      for (var i in options.debug) {
        var d = options.debug[i]
        switch (d) {
          case 'trace':
            Janus.trace = console.trace.bind(console)
            break
          case 'debug':
            Janus.debug = console.debug.bind(console)
            break
          case 'vdebug':
            Janus.vdebug = console.debug.bind(console)
            break
          case 'log':
            Janus.log = console.log.bind(console)
            break
          case 'warn':
            Janus.warn = console.warn.bind(console)
            break
          case 'error':
            Janus.error = console.error.bind(console)
            break
          default:
            console.error('Unknown debugging option \'' + d + '\' (supported: \'trace\', \'debug\', \'vdebug\', \'log\', warn\', \'error\')')
            break
        }
      }
    }
    Janus.log('Initializing library')

    var usedDependencies = options.dependencies || Janus.useDefaultDependencies()
    Janus.isArray = usedDependencies.isArray
    Janus.httpAPICall = usedDependencies.httpAPICall
    Janus.newWebSocket = usedDependencies.newWebSocket

    // Helper method to enumerate devices
    Janus.listDevices = function (callback, config) {
      callback = (typeof callback == 'function') ? callback : Janus.noop
      if (config == null) {
        config = {
          audio: true,
          video: true
        }
      }
      callback([])
    }
    // Detect tab close: make sure we don't loose existing onbeforeunload handlers
    // (note: for iOS we need to subscribe to a different event, 'pagehide', see
    // https://gist.github.com/thehunmonkgroup/6bee8941a49b86be31a787fe8f4b8cfe)
    Janus.initDone = true
    options.callback()
  }
}

// Helper method to check whether devices can be accessed by this browser (e.g., not possible via plain HTTP)
Janus.isGetUserMediaAvailable = function () {
  return true
}

// Helper method to create random identifiers (e.g., transaction)
Janus.randomString = function (len) {
  var charSet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  var randomString = ''
  for (var i = 0; i < len; i++) {
    var randomPoz = Math.floor(Math.random() * charSet.length)
    randomString += charSet.substring(randomPoz, randomPoz + 1)
  }
  return randomString
}

function Janus (gatewayCallbacks) {
  if (Janus.initDone === undefined) {
    gatewayCallbacks.error('Library not initialized')
    return {}
  }
  Janus.log('Library initialized: ' + Janus.initDone)
  gatewayCallbacks = gatewayCallbacks || {}
  gatewayCallbacks.success = (typeof gatewayCallbacks.success == 'function') ? gatewayCallbacks.success : Janus.noop
  gatewayCallbacks.error = (typeof gatewayCallbacks.error == 'function') ? gatewayCallbacks.error : Janus.noop
  gatewayCallbacks.destroyed = (typeof gatewayCallbacks.destroyed == 'function') ? gatewayCallbacks.destroyed : Janus.noop
  if (gatewayCallbacks.server === null || gatewayCallbacks.server === undefined) {
    gatewayCallbacks.error('Invalid server url')
    return {}
  }
  var websockets = false
  var ws = null
  var wsHandlers = {}
  var wsKeepaliveTimeoutId = null

  var servers = null,
    serversIndex = 0
  var server = gatewayCallbacks.server
  if (Janus.isArray(server)) {
    Janus.log('Multiple servers provided (' + server.length + '), will use the first that works')
    server = null
    servers = gatewayCallbacks.server
    Janus.debug(servers)
  } else {
    if (server.indexOf('ws') === 0) {
      websockets = true
      Janus.log('Using WebSockets to contact Janus: ' + server)
    } else {
      websockets = false
      Janus.log('Using REST API to contact Janus: ' + server)
    }
  }

  var bundlePolicy = gatewayCallbacks.bundlePolicy
  // Whether we should enable the withCredentials flag for XHR requests
  var withCredentials = false
  if (gatewayCallbacks.withCredentials !== undefined && gatewayCallbacks.withCredentials !== null) {
    withCredentials = gatewayCallbacks.withCredentials === true
  }
  // Optional max events
  var maxev = 10
  if (gatewayCallbacks.max_poll_events !== undefined && gatewayCallbacks.max_poll_events !== null) {
    maxev = gatewayCallbacks.max_poll_events
  }
  if (maxev < 1) {
    maxev = 1
  }
  // Token to use (only if the token based authentication mechanism is enabled)
  var token = null
  if (gatewayCallbacks.token !== undefined && gatewayCallbacks.token !== null) {
    token = gatewayCallbacks.token
  }
  // API secret to use (only if the shared API secret is enabled)
  var apisecret = null
  if (gatewayCallbacks.apisecret !== undefined && gatewayCallbacks.apisecret !== null) {
    apisecret = gatewayCallbacks.apisecret
  }
  // Whether we should destroy this session when onbeforeunload is called
  this.destroyOnUnload = true
  if (gatewayCallbacks.destroyOnUnload !== undefined && gatewayCallbacks.destroyOnUnload !== null) {
    this.destroyOnUnload = (gatewayCallbacks.destroyOnUnload === true)
  }
  // Some timeout-related values
  var keepAlivePeriod = 5000
  if (gatewayCallbacks.keepAlivePeriod !== undefined && gatewayCallbacks.keepAlivePeriod !== null) {
    keepAlivePeriod = gatewayCallbacks.keepAlivePeriod
  }
  if (isNaN(keepAlivePeriod)) {
    keepAlivePeriod = 5000
  }
  var longPollTimeout = 60000
  if (gatewayCallbacks.longPollTimeout !== undefined && gatewayCallbacks.longPollTimeout !== null) {
    longPollTimeout = gatewayCallbacks.longPollTimeout
  }
  if (isNaN(longPollTimeout)) {
    longPollTimeout = 60000
  }

  var connected = false
  var sessionId = null
  var pluginHandles = {}
  var that = this
  var retries = 0
  var transactions = {}
  createSession(gatewayCallbacks)

  // Public methods
  this.getServer = function () {
    return server
  }
  this.isConnected = function () {
    return connected
  }
  this.reconnect = function (callbacks) {
    callbacks = callbacks || {}
    callbacks.success = (typeof callbacks.success == 'function') ? callbacks.success : Janus.noop
    callbacks.error = (typeof callbacks.error == 'function') ? callbacks.error : Janus.noop
    callbacks['reconnect'] = true
    createSession(callbacks)
  }
  this.getSessionId = function () {
    return sessionId
  }
  this.destroy = function (callbacks) {
    destroySession(callbacks)
  }
  this.attach = function (callbacks) {
    createHandle(callbacks)
  }

  function eventHandler () {
    if (sessionId == null) {
      return
    }
    Janus.debug('Long poll...')
    if (!connected) {
      Janus.warn('Is the server down? (connected=false)')
      return
    }
    var longpoll = server + '/' + sessionId + '?rid=' + new Date().getTime()
    if (maxev !== undefined && maxev !== null) {
      longpoll = longpoll + '&maxev=' + maxev
    }
    if (token !== null && token !== undefined) {
      longpoll = longpoll + '&token=' + encodeURIComponent(token)
    }
    if (apisecret !== null && apisecret !== undefined) {
      longpoll = longpoll + '&apisecret=' + encodeURIComponent(apisecret)
    }

  }

  // Private event handler: this will trigger plugin callbacks, if set
  function handleEvent (json, skipTimeout) {
    retries = 0
    if (!websockets && sessionId !== undefined && sessionId !== null && skipTimeout !== true) {
      eventHandler()
    }
    if (!websockets && Janus.isArray(json)) {
      // We got an array: it means we passed a maxev > 1, iterate on all objects
      for (var i = 0; i < json.length; i++) {
        handleEvent(json[i], true)
      }
      return
    }
    if (json['janus'] === 'keepalive') {
      // Nothing happened
      Janus.vdebug('Got a keepalive on session ' + sessionId)
      return
    } else if (json['janus'] === 'ack') {
      // Just an ack, we can probably ignore
      Janus.debug('Got an ack on session ' + sessionId)
      Janus.debug(json)
      var transaction = json['transaction']
      if (transaction !== null && transaction !== undefined) {
        var reportSuccess = transactions[transaction]
        if (reportSuccess !== null && reportSuccess !== undefined) {
          reportSuccess(json)
        }
        delete transactions[transaction]
      }
      return
    } else if (json['janus'] === 'success') {
      // Success!
      Janus.debug('Got a success on session ' + sessionId)
      Janus.debug(json)
      var transaction = json['transaction']
      if (transaction !== null && transaction !== undefined) {
        var reportSuccess = transactions[transaction]
        if (reportSuccess !== null && reportSuccess !== undefined) {
          reportSuccess(json)
        }
        delete transactions[transaction]
      }
      return
    } else if (json['janus'] === 'trickle') {
      // We got a trickle candidate from Janus
      var sender = json['sender']
      if (sender === undefined || sender === null) {
        Janus.warn('Missing sender...')
        return
      }
      var pluginHandle = pluginHandles[sender]
      if (pluginHandle === undefined || pluginHandle === null) {
        Janus.debug('This handle is not attached to this session')
        return
      }
      var candidate = json['candidate']
      Janus.debug('Got a trickled candidate on session ' + sessionId)
      Janus.debug(candidate)
      var config = pluginHandle.wechatStuff
      if (config.pc && config.remoteSdp) {
        // Add candidate right now
        Janus.debug('Adding remote candidate:', candidate)
        if (!candidate || candidate.completed === true) {
          // end-of-candidates
          config.pc.addIceCandidate(Janus.endOfCandidates)
        } else {
          // New candidate
          config.pc.addIceCandidate(candidate)
        }
      } else {
        // We didn't do setRemoteDescription (trickle got here before the offer?)
        Janus.debug('We didn\'t do setRemoteDescription (trickle got here before the offer?), caching candidate')
        if (!config.candidates) {
          config.candidates = []
        }
        config.candidates.push(candidate)
        Janus.debug(config.candidates)
      }
    } else if (json['janus'] === 'hangup') {
      // A plugin asked the core to hangup a PeerConnection on one of our handles
      Janus.debug('Got a hangup event on session ' + sessionId)
      Janus.debug(json)
      var sender = json['sender']
      if (sender === undefined || sender === null) {
        Janus.warn('Missing sender...')
        return
      }
      var pluginHandle = pluginHandles[sender]
      if (pluginHandle === undefined || pluginHandle === null) {
        Janus.debug('This handle is not attached to this session')
        return
      }
      pluginHandle.hangup()
    } else if (json['janus'] === 'detached') {
      // A plugin asked the core to detach one of our handles
      Janus.debug('Got a detached event on session ' + sessionId)
      Janus.debug(json)
      var sender = json['sender']
      if (sender === undefined || sender === null) {
        Janus.warn('Missing sender...')
        return
      }
      var pluginHandle = pluginHandles[sender]
      if (pluginHandle === undefined || pluginHandle === null) {
        // Don't warn here because destroyHandle causes this situation.
        return
      }
      pluginHandle.detached = true
      pluginHandle.ondetached()
      pluginHandle.detach()
    } else if (json['janus'] === 'media') {
      // Media started/stopped flowing
      Janus.debug('Got a media event on session ' + sessionId)
      Janus.debug(json)
      var sender = json['sender']
      if (sender === undefined || sender === null) {
        Janus.warn('Missing sender...')
        return
      }
      var pluginHandle = pluginHandles[sender]
      if (pluginHandle === undefined || pluginHandle === null) {
        Janus.debug('This handle is not attached to this session')
        return
      }
      pluginHandle.mediaState(json['type'], json['receiving'])
    } else if (json['janus'] === 'slowlink') {
      Janus.debug('Got a slowlink event on session ' + sessionId)
      Janus.debug(json)
      // Trouble uplink or downlink
      var sender = json['sender']
      if (sender === undefined || sender === null) {
        Janus.warn('Missing sender...')
        return
      }
      var pluginHandle = pluginHandles[sender]
      if (pluginHandle === undefined || pluginHandle === null) {
        Janus.debug('This handle is not attached to this session')
        return
      }
      pluginHandle.slowLink(json['uplink'], json['lost'])
    } else if (json['janus'] === 'error') {
      // Oops, something wrong happened
      Janus.error('Ooops: ' + json['error'].code + ' ' + json['error'].reason) // FIXME
      Janus.debug(json)
      var transaction = json['transaction']
      if (transaction !== null && transaction !== undefined) {
        var reportSuccess = transactions[transaction]
        if (reportSuccess !== null && reportSuccess !== undefined) {
          reportSuccess(json)
        }
        delete transactions[transaction]
      }
      return
    } else if (json['janus'] === 'event') {
      Janus.debug('Got a plugin event on session ' + sessionId)
      Janus.debug(json)
      var sender = json['sender']
      if (sender === undefined || sender === null) {
        Janus.warn('Missing sender...')
        return
      }
      var plugindata = json['plugindata']
      if (plugindata === undefined || plugindata === null) {
        Janus.warn('Missing plugindata...')
        return
      }
      Janus.debug('  -- Event is coming from ' + sender + ' (' + plugindata['plugin'] + ')')
      var data = plugindata['data']
      Janus.debug(data)
      var pluginHandle = pluginHandles[sender]
      if (pluginHandle === undefined || pluginHandle === null) {
        Janus.warn('This handle is not attached to this session')
        return
      }
      var callback = pluginHandle.onmessage
      if (callback !== null && callback !== undefined) {
        Janus.debug('Notifying application...')
        // Send to callback specified when attaching plugin handle
        callback(data)
      } else {
        // Send to generic callback (?)
        Janus.debug('No provided notification callback')
      }
    } else if (json['janus'] === 'timeout') {
      Janus.error('Timeout on session ' + sessionId)
      Janus.debug(json)
      if (websockets) {
        // ws.close(3504, "Gateway timeout");
        ws.close()

      }
      return
    } else {
      Janus.warn('Unknown message/event  \'' + json['janus'] + '\' on session ' + sessionId)
      Janus.debug(json)
    }
  }

  // Private helper to send keep-alive messages on WebSockets
  function keepAlive () {
    ws.onMessage((res) => {
      handleEvent(JSON.parse(res.data))
    })
    ws.onError(res => {
      console.error('接收到socket错误信息', res)
    })
    ws.onClose(res => {
      console.error('接收到socket关闭', res)
    })
    if (server === null || !websockets || !connected) {
      Janus.log('keepAlive Err! server:' + server + ' websockets:' + websockets + ' connected:' + connected)
      return
    }
    // Janus.log("keepAlive send " + wsKeepaliveTimeoutId);
    wsKeepaliveTimeoutId = setTimeout(keepAlive, keepAlivePeriod)
    var request = {
      'janus': 'keepalive',
      'session_id': sessionId,
      'transaction': Janus.randomString(12)
    }
    if (token !== null && token !== undefined) {
      request['token'] = token
    }

    if (apisecret !== null && apisecret !== undefined) {
      request['apisecret'] = apisecret
    }

    ws.send({
      data: JSON.stringify(request),
      success: function (res) {
        // gatewayCallbacks.success("send OK");
      },
      fail: function (res) {
        console.error('keep发送错误', res)
        gatewayCallbacks.error('websocketBreak')
        if (wsKeepaliveTimeoutId) {
          clearTimeout(wsKeepaliveTimeoutId)
        }
        // return false
      }
    })
  }

  // Private method to create a session
  function createSession (callbacks) {

    var transaction = Janus.randomString(12)
    var request = {
      'janus': 'create',
      'transaction': transaction
    }
    if (callbacks['reconnect']) {
      // We're reconnecting, claim the session
      connected = false
      request['janus'] = 'claim'
      request['session_id'] = sessionId
      // If we were using websockets, ignore the old connection
      if (ws) {
        if (wsKeepaliveTimeoutId) {
          clearTimeout(wsKeepaliveTimeoutId)
          wsKeepaliveTimeoutId = null
        }
      }
    }
    if (token !== null && token !== undefined) {
      request['token'] = token
    }
    if (apisecret !== null && apisecret !== undefined) {
      request['apisecret'] = apisecret
    }
    if (server === null && Janus.isArray(servers)) {
      // We still need to find a working server from the list we were given
      server = servers[serversIndex]
      if (server.indexOf('ws') === 0) {
        websockets = true
        Janus.log('Server #' + (serversIndex + 1) + ': trying WebSockets to contact Janus (' + server + ')')
      } else {
        websockets = false
        Janus.log('Server #' + (serversIndex + 1) + ': trying REST API to contact Janus (' + server + ')')
      }
    }
    if (websockets) {
      ws = Janus.newWebSocket()
      ws.onOpen((res) => {
        transactions[transaction] = function (json) {
          Janus.debug(json)
          if (json['janus'] !== 'success') {
            Janus.error('Ooops: ' + json['error'].code + ' ' + json['error'].reason) // FIXME
            callbacks.error(json['error'].reason)
            return
          }
          wsKeepaliveTimeoutId = setTimeout(keepAlive, keepAlivePeriod)
          connected = true
          sessionId = json['session_id'] ? json['session_id'] : json.data['id']
          if (callbacks['reconnect']) {
            Janus.log('Claimed session: ' + sessionId)
          } else {
            Janus.log('Created session: ' + sessionId)
          }
          Janus.sessions[sessionId] = that
          callbacks.success()
        }
        ws.send({
          data: JSON.stringify(request),
          complete: function (res) {
          }
        })
      })
      ws.onMessage((res) => {
        handleEvent(JSON.parse(res.data))
      })

      return
    }
  }

  // Private method to destroy a session
  function destroySession (callbacks) {
    callbacks = callbacks || {}
    // FIXME This method triggers a success even when we fail
    callbacks.success = (typeof callbacks.success == 'function') ? callbacks.success : Janus.noop
    var asyncRequest = true
    if (callbacks.asyncRequest !== undefined && callbacks.asyncRequest !== null) {
      asyncRequest = (callbacks.asyncRequest === true)
    }
    var notifyDestroyed = true
    if (callbacks.notifyDestroyed !== undefined && callbacks.notifyDestroyed !== null) {
      notifyDestroyed = (callbacks.notifyDestroyed === true)
    }
    var cleanupHandles = true
    if (callbacks.cleanupHandles !== undefined && callbacks.cleanupHandles !== null) {
      cleanupHandles = (callbacks.cleanupHandles === true)
    }
    Janus.log('Destroying session ' + sessionId + ' (async=' + asyncRequest + ')')
    if (sessionId === undefined || sessionId === null) {
      Janus.warn('No session to destroy')
      callbacks.success()
      if (notifyDestroyed) {
        gatewayCallbacks.destroyed()
      }
      return
    }
    console.log('cleanupHandles', cleanupHandles)
    if (cleanupHandles) {
      for (var handleId in pluginHandles) {
        destroyHandle(handleId, {
          noRequest: true
        })
      }
    }
    if (!connected) {
      Janus.warn('Is the server down? (connected=false)')
      callbacks.success()
      return
    }
    // No need to destroy all handles first, Janus will do that itself
    var request = {
      'janus': 'destroy',
      'transaction': Janus.randomString(12)
    }
    if (token !== null && token !== undefined) {
      request['token'] = token
    }
    if (apisecret !== null && apisecret !== undefined) {
      request['apisecret'] = apisecret
    }
    if (websockets) {
      request['session_id'] = sessionId
      var unbindWebSocket = function () {
        if (wsKeepaliveTimeoutId) {
          clearTimeout(wsKeepaliveTimeoutId)
        }
        ws.close()
      }
      var onUnbindMessage = function (event) {
        var data = JSON.parse(event.data)
        if (data.session_id == request.session_id && data.transaction == request.transaction) {
          unbindWebSocket()
          callbacks.success()
          if (notifyDestroyed) {
            gatewayCallbacks.destroyed()
          }
        }
      }
      var onUnbindError = function (event) {
        unbindWebSocket()
        callbacks.error('Failed to destroy the server: Is the server down?')
        if (notifyDestroyed) {
          gatewayCallbacks.destroyed()
        }
      }

      ws.onError((result) => {
        onUnbindError(result)
      })
      ws.send({
        data: JSON.stringify(request),
        success: function (res) {
          console.log('销毁发送成功～', res)
        },
        fail: function (res) {
          console.error('销毁发送失败～', res)
        }
      })
      ws.onMessage((res) => {
        onUnbindMessage(res)
      })
      return
    }
  }

  // Private method to create a plugin handle
  function createHandle (callbacks) {
    callbacks = callbacks || {}
    callbacks.success = (typeof callbacks.success == 'function') ? callbacks.success : Janus.noop
    callbacks.error = (typeof callbacks.error == 'function') ? callbacks.error : Janus.noop
    callbacks.consentDialog = (typeof callbacks.consentDialog == 'function') ? callbacks.consentDialog : Janus.noop
    callbacks.mediaState = (typeof callbacks.mediaState == 'function') ? callbacks.mediaState : Janus.noop
    callbacks.slowLink = (typeof callbacks.slowLink == 'function') ? callbacks.slowLink : Janus.noop
    callbacks.onmessage = (typeof callbacks.onmessage == 'function') ? callbacks.onmessage : Janus.noop
    callbacks.onlocalstream = (typeof callbacks.onlocalstream == 'function') ? callbacks.onlocalstream : Janus.noop
    callbacks.onremotestream = (typeof callbacks.onremotestream == 'function') ? callbacks.onremotestream : Janus.noop
    callbacks.ondata = (typeof callbacks.ondata == 'function') ? callbacks.ondata : Janus.noop
    callbacks.ondataopen = (typeof callbacks.ondataopen == 'function') ? callbacks.ondataopen : Janus.noop
    callbacks.oncleanup = (typeof callbacks.oncleanup == 'function') ? callbacks.oncleanup : Janus.noop
    callbacks.ondetached = (typeof callbacks.ondetached == 'function') ? callbacks.ondetached : Janus.noop
    if (!connected) {
      Janus.warn('Is the server down? (connected=false)')
      callbacks.error('Is the server down? (connected=false)')
      return
    }
    var plugin = callbacks.plugin
    if (plugin === undefined || plugin === null) {
      Janus.error('Invalid plugin')
      callbacks.error('Invalid plugin')
      return
    }
    var opaqueId = callbacks.opaqueId
    var handleToken = callbacks.token ? callbacks.token : token
    var transaction = Janus.randomString(12)
    var request = {
      'janus': 'attach',
      'plugin': plugin,
      'opaque_id': opaqueId,
      'transaction': transaction
    }
    if (handleToken !== null && handleToken !== undefined) {
      request['token'] = handleToken
    }
    if (apisecret !== null && apisecret !== undefined) {
      request['apisecret'] = apisecret
    }
    if (websockets) {
      transactions[transaction] = function (json) {
        Janus.debug(json)
        if (json['janus'] !== 'success') {
          Janus.error('Ooops: ' + json['error'].code + ' ' + json['error'].reason) // FIXME
          callbacks.error('Ooops: ' + json['error'].code + ' ' + json['error'].reason)
          return
        }
        var handleId = json.data['id']
        Janus.log('Created handle: ' + handleId)
        var pluginHandle = {
          session: that,
          plugin: plugin,
          id: handleId,
          token: handleToken,
          detached: false,
          wechatStuff: {
            started: false,
            myStream: null,
            remoteStream: null,
            mediaConstraints: null,
            pc: null,
            dataChannel: {},
            dtmfSender: null,
            volume: {
              value: null,
              timer: null
            },
            bitrate: {
              value: null,
              bsnow: null,
              bsbefore: null,
              tsnow: null,
              tsbefore: null,
              timer: null
            }
          },
          getId: function () {
            return handleId
          },
          getPlugin: function () {
            return plugin
          },
          getVolume: function () {
            return getVolume(handleId, true)
          },
          getRemoteVolume: function () {
            return getVolume(handleId, true)
          },
          getLocalVolume: function () {
            return getVolume(handleId, false)
          },
          isAudioMuted: function () {
            return isMuted(handleId, false)
          },
          muteAudio: function () {
            return mute(handleId, false, true)
          },
          unmuteAudio: function () {
            return mute(handleId, false, false)
          },
          isVideoMuted: function () {
            return isMuted(handleId, true)
          },
          muteVideo: function () {
            return mute(handleId, true, true)
          },
          unmuteVideo: function () {
            return mute(handleId, true, false)
          },
          getBitrate: function () {
            return getBitrate(handleId)
          },
          send: function (callbacks) {
            sendMessage(handleId, callbacks)
          },
          data: function (callbacks) {
            sendData(handleId, callbacks)
          },
          dtmf: function (callbacks) {
            sendDtmf(handleId, callbacks)
          },
          consentDialog: callbacks.consentDialog,
          mediaState: callbacks.mediaState,
          slowLink: callbacks.slowLink,
          onmessage: callbacks.onmessage,
          onlocalstream: callbacks.onlocalstream,
          onremotestream: callbacks.onremotestream,
          ondata: callbacks.ondata,
          ondataopen: callbacks.ondataopen,
          oncleanup: callbacks.oncleanup,
          ondetached: callbacks.ondetached,
          hangup: function (sendRequest) {
            cleanupWechat(handleId, sendRequest === true)
          },
          detach: function (callbacks) {
            destroyHandle(handleId, callbacks)
          }
        }
        pluginHandles[handleId] = pluginHandle
        callbacks.success(pluginHandle)
      }
      request['session_id'] = sessionId
      ws.send({
        data: JSON.stringify(request)
      })
      return
    }
  }

  // Private method to send a message
  function sendMessage (handleId, callbacks) {

    callbacks = callbacks || {}
    callbacks.success = (typeof callbacks.success == 'function') ? callbacks.success : Janus.noop
    callbacks.error = (typeof callbacks.error == 'function') ? callbacks.error : Janus.noop
    if (!connected) {
      Janus.warn('Is the server down? (connected=false)')
      callbacks.error('Is the server down? (connected=false)')
      return
    }
    var pluginHandle = pluginHandles[handleId]
    if (pluginHandle === null || pluginHandle === undefined ||
      pluginHandle.wechatStuff === null || pluginHandle.wechatStuff === undefined) {
      Janus.warn('Invalid handle')
      gatewayCallbacks.error('websocketBreak')
      if (wsKeepaliveTimeoutId) {
        clearTimeout(wsKeepaliveTimeoutId)
      }
      callbacks.error('Invalid handle')
      return
    }
    var message = callbacks.message
    var transaction = Janus.randomString(12)
    var request = {
      'janus': 'message',
      'body': message,
      'transaction': transaction
    }
    if (pluginHandle.token !== null && pluginHandle.token !== undefined) {
      request['token'] = pluginHandle.token
    }
    if (apisecret !== null && apisecret !== undefined) {
      request['apisecret'] = apisecret
    }
    Janus.debug('Sending message to plugin (handle=' + handleId + '):')
    Janus.debug(request)
    if (websockets) {
      request['session_id'] = sessionId
      request['handle_id'] = handleId
      transactions[transaction] = function (json) {
        Janus.debug('Message sent!')
        Janus.debug(json)
        if (json['janus'] === 'success') {
          // We got a success, must have been a synchronous transaction
          var plugindata = json['plugindata']
          if (plugindata === undefined || plugindata === null) {
            Janus.warn('Request succeeded, but missing plugindata...')
            callbacks.success()
            return
          }
          Janus.log('Synchronous transaction successful (' + plugindata['plugin'] + ')')
          var data = plugindata['data']
          Janus.debug(data)
          callbacks.success(data)
          return
        } else if (json['janus'] !== 'ack') {
          // Not a success and not an ack, must be an error
          if (json['error'] !== undefined && json['error'] !== null) {
            Janus.error('Ooops: ' + json['error'].code + ' ' + json['error'].reason) // FIXME
            callbacks.error(json['error'].code + ' ' + json['error'].reason)
          } else {
            Janus.error('Unknown error') // FIXME
            callbacks.error('Unknown error')
          }
          return
        }
        // If we got here, the plugin decided to handle the request asynchronously
        callbacks.success()
      }
      ws.send({
        data: JSON.stringify(request),
        fail: function (res) {
          // Janus.error('我断开连接了！');
          console.error('socketsendmessage错误', res)
          // destroyHandle(handleId, callbacks)
        }
      })
    }
  }

  // Private method to create a data channel
  function createDataChannel (handleId, dclabel, incoming, pendingText) {
    var pluginHandle = pluginHandles[handleId]
    if (pluginHandle === null || pluginHandle === undefined ||
      pluginHandle.wechatStuff === null || pluginHandle.wechatStuff === undefined) {
      Janus.warn('Invalid handle')
      gatewayCallbacks.error('websocketBreak')
      if (wsKeepaliveTimeoutId) {
        clearTimeout(wsKeepaliveTimeoutId)
      }
      return
    }
    var config = pluginHandle.wechatStuff
    var onDataChannelMessage = function (event) {
      Janus.log('Received message on data channel:', event)
      var label = event.target.label
      pluginHandle.ondata(event.data, label)
    }
    var onDataChannelStateChange = function (event) {
      Janus.log('Received state change on data channel:', event)
      var label = event.target.label
      var dcState = config.dataChannel[label] ? config.dataChannel[label].readyState : 'null'
      Janus.log('State change on <' + label + '> data channel: ' + dcState)
      if (dcState === 'open') {
        // Any pending messages to send?
        if (config.dataChannel[label].pending && config.dataChannel[label].pending.length > 0) {
          Janus.log('Sending pending messages on <' + label + '>:', config.dataChannel[label].pending.length)
          for (var i in config.dataChannel[label].pending) {
            var text = config.dataChannel[label].pending[i]
            Janus.log('Sending string on data channel <' + label + '>: ' + text)
            config.dataChannel[label].send(text)
          }
          config.dataChannel[label].pending = []
        }
        // Notify the open data channel
        pluginHandle.ondataopen(label)
      }
    }
    var onDataChannelError = function (error) {
      Janus.error('Got error on data channel:', error)
      // TODO
    }
    if (!incoming) {
      // FIXME Add options (ordered, maxRetransmits, etc.)
      config.dataChannel[dclabel] = config.pc.createDataChannel(dclabel, {
        ordered: false
      })
    } else {
      // The channel was created by Janus
      config.dataChannel[dclabel] = incoming
    }
    config.dataChannel[dclabel].onmessage = onDataChannelMessage
    config.dataChannel[dclabel].onopen = onDataChannelStateChange
    config.dataChannel[dclabel].onclose = onDataChannelStateChange
    config.dataChannel[dclabel].onerror = onDataChannelError
    config.dataChannel[dclabel].pending = []
    if (pendingText) {
      config.dataChannel[dclabel].pending.push(pendingText)
    }
  }

  // Private method to send a data channel message
  function sendData (handleId, callbacks) {
    callbacks = callbacks || {}
    callbacks.success = (typeof callbacks.success == 'function') ? callbacks.success : Janus.noop
    callbacks.error = (typeof callbacks.error == 'function') ? callbacks.error : Janus.noop
    var pluginHandle = pluginHandles[handleId]
    if (pluginHandle === null || pluginHandle === undefined ||
      pluginHandle.wechatStuff === null || pluginHandle.wechatStuff === undefined) {
      Janus.warn('Invalid handle')
      gatewayCallbacks.error('websocketBreak')
      if (wsKeepaliveTimeoutId) {
        clearTimeout(wsKeepaliveTimeoutId)
      }
      callbacks.error('Invalid handle')
      return
    }
    var config = pluginHandle.wechatStuff
    var text = callbacks.text
    if (text === null || text === undefined) {
      Janus.warn('Invalid text')
      callbacks.error('Invalid text')
      return
    }
    var label = callbacks.label ? callbacks.label : Janus.dataChanDefaultLabel
    if (!config.dataChannel[label]) {
      // Create new data channel and wait for it to open
      createDataChannel(handleId, label, false, text)
      callbacks.success()
      return
    }
    if (config.dataChannel[label].readyState !== 'open') {
      config.dataChannel[label].pending.push(text)
      callbacks.success()
      return
    }
    Janus.log('Sending string on data channel <' + label + '>: ' + text)
    config.dataChannel[label].send(text)
    callbacks.success()
  }

  // Private method to send a DTMF tone
  function sendDtmf (handleId, callbacks) {
    callbacks = callbacks || {}
    callbacks.success = (typeof callbacks.success == 'function') ? callbacks.success : Janus.noop
    callbacks.error = (typeof callbacks.error == 'function') ? callbacks.error : Janus.noop
    var pluginHandle = pluginHandles[handleId]
    if (pluginHandle === null || pluginHandle === undefined ||
      pluginHandle.wechatStuff === null || pluginHandle.wechatStuff === undefined) {
      Janus.warn('Invalid handle')
      gatewayCallbacks.error('websocketBreak')
      if (wsKeepaliveTimeoutId) {
        clearTimeout(wsKeepaliveTimeoutId)
      }
      callbacks.error('Invalid handle')
      return
    }
    var config = pluginHandle.wechatStuff
    if (config.dtmfSender === null || config.dtmfSender === undefined) {
      // Create the DTMF sender the proper way, if possible
      if (config.pc !== undefined && config.pc !== null) {
        var senders = config.pc.getSenders()
        var audioSender = senders.find(function (sender) {
          return sender.track && sender.track.kind === 'audio'
        })
        if (!audioSender) {
          Janus.warn('Invalid DTMF configuration (no audio track)')
          callbacks.error('Invalid DTMF configuration (no audio track)')
          return
        }
        config.dtmfSender = audioSender.dtmf
        if (config.dtmfSender) {
          Janus.log('Created DTMF Sender')
          config.dtmfSender.ontonechange = function (tone) {
            Janus.debug('Sent DTMF tone: ' + tone.tone)
          }
        }
      }
      if (config.dtmfSender === null || config.dtmfSender === undefined) {
        Janus.warn('Invalid DTMF configuration')
        callbacks.error('Invalid DTMF configuration')
        return
      }
    }
    var dtmf = callbacks.dtmf
    if (dtmf === null || dtmf === undefined) {
      Janus.warn('Invalid DTMF parameters')
      callbacks.error('Invalid DTMF parameters')
      return
    }
    var tones = dtmf.tones
    if (tones === null || tones === undefined) {
      Janus.warn('Invalid DTMF string')
      callbacks.error('Invalid DTMF string')
      return
    }
    var duration = dtmf.duration
    if (duration === null || duration === undefined) {
      duration = 500
    } // We choose 500ms as the default duration for a tone
    var gap = dtmf.gap
    if (gap === null || gap === undefined) {
      gap = 50
    } // We choose 50ms as the default gap between tones
    Janus.debug('Sending DTMF string ' + tones + ' (duration ' + duration + 'ms, gap ' + gap + 'ms)')
    config.dtmfSender.insertDTMF(tones, duration, gap)
    callbacks.success()
  }

  // Private method to destroy a plugin handle
  function destroyHandle (handleId, callbacks) {
    callbacks = callbacks || {}
    callbacks.success = (typeof callbacks.success == 'function') ? callbacks.success : Janus.noop
    callbacks.error = (typeof callbacks.error == 'function') ? callbacks.error : Janus.noop
    var asyncRequest = true
    if (callbacks.asyncRequest !== undefined && callbacks.asyncRequest !== null) {
      asyncRequest = (callbacks.asyncRequest === true)
    }
    var noRequest = true
    if (callbacks.noRequest !== undefined && callbacks.noRequest !== null) {
      noRequest = (callbacks.noRequest === true)
    }
    Janus.log('Destroying handle ' + handleId + ' (async=' + asyncRequest + ')')
    cleanupWechat(handleId)
    var pluginHandle = pluginHandles[handleId]
    if (pluginHandle === null || pluginHandle === undefined || pluginHandle.detached) {
      // Plugin was already detached by Janus, calling detach again will return a handle not found error, so just exit here
      delete pluginHandles[handleId]
      callbacks.success()
      return
    }
    if (noRequest) {
      // We're only removing the handle locally
      delete pluginHandles[handleId]
      callbacks.success()
      return
    }
    if (!connected) {
      Janus.warn('Is the server down? (connected=false)')
      callbacks.error('Is the server down? (connected=false)')
      return
    }
    var request = {
      'janus': 'detach',
      'transaction': Janus.randomString(12)
    }
    if (pluginHandle.token !== null && pluginHandle.token !== undefined) {
      request['token'] = pluginHandle.token
    }
    if (apisecret !== null && apisecret !== undefined) {
      request['apisecret'] = apisecret
    }
    if (websockets) {
      request['session_id'] = sessionId
      request['handle_id'] = handleId
      console.log('request------', request)
      ws.send({
        data: JSON.stringify(request)
      })
      delete pluginHandles[handleId]
      callbacks.success()
      return
    }
  }

  function getVolume (handleId, remote) {
    var pluginHandle = pluginHandles[handleId]
    if (pluginHandle === null || pluginHandle === undefined ||
      pluginHandle.wechatStuff === null || pluginHandle.wechatStuff === undefined) {
      Janus.warn('Invalid handle')
      gatewayCallbacks.error('websocketBreak')
      if (wsKeepaliveTimeoutId) {
        clearTimeout(wsKeepaliveTimeoutId)
      }
      return 0
    }
    var stream = remote ? 'remote' : 'local'
    var config = pluginHandle.wechatStuff
    if (!config.volume[stream]) {
      config.volume[stream] = {
        value: 0
      }
    }
    // Start getting the volume, if getStats is supported
  }

  function isMuted (handleId, video) {
    var pluginHandle = pluginHandles[handleId]
    if (pluginHandle === null || pluginHandle === undefined ||
      pluginHandle.wechatStuff === null || pluginHandle.wechatStuff === undefined) {
      Janus.warn('Invalid handle')
      gatewayCallbacks.error('websocketBreak')
      if (wsKeepaliveTimeoutId) {
        clearTimeout(wsKeepaliveTimeoutId)
      }
      return true
    }
    var config = pluginHandle.wechatStuff
    if (config.pc === null || config.pc === undefined) {
      Janus.warn('Invalid PeerConnection')
      return true
    }
    if (config.myStream === undefined || config.myStream === null) {
      Janus.warn('Invalid local MediaStream')
      return true
    }
    if (video) {
      // Check video track
      if (config.myStream.getVideoTracks() === null ||
        config.myStream.getVideoTracks() === undefined ||
        config.myStream.getVideoTracks().length === 0) {
        Janus.warn('No video track')
        return true
      }
      return !config.myStream.getVideoTracks()[0].enabled
    } else {
      // Check audio track
      if (config.myStream.getAudioTracks() === null ||
        config.myStream.getAudioTracks() === undefined ||
        config.myStream.getAudioTracks().length === 0) {
        Janus.warn('No audio track')
        return true
      }
      return !config.myStream.getAudioTracks()[0].enabled
    }
  }

  function mute (handleId, video, mute) {
    var pluginHandle = pluginHandles[handleId]
    if (pluginHandle === null || pluginHandle === undefined ||
      pluginHandle.wechatStuff === null || pluginHandle.wechatStuff === undefined) {
      Janus.warn('Invalid handle')
      return false
    }
    var config = pluginHandle.wechatStuff
    if (config.pc === null || config.pc === undefined) {
      Janus.warn('Invalid PeerConnection')
      return false
    }
    if (config.myStream === undefined || config.myStream === null) {
      Janus.warn('Invalid local MediaStream')
      return false
    }
    if (video) {
      // Mute/unmute video track
      if (config.myStream.getVideoTracks() === null ||
        config.myStream.getVideoTracks() === undefined ||
        config.myStream.getVideoTracks().length === 0) {
        Janus.warn('No video track')
        return false
      }
      config.myStream.getVideoTracks()[0].enabled = mute ? false : true
      return true
    } else {
      // Mute/unmute audio track
      if (config.myStream.getAudioTracks() === null ||
        config.myStream.getAudioTracks() === undefined ||
        config.myStream.getAudioTracks().length === 0) {
        Janus.warn('No audio track')
        return false
      }
      config.myStream.getAudioTracks()[0].enabled = mute ? false : true
      return true
    }
  }

  function getBitrate (handleId) {
    var pluginHandle = pluginHandles[handleId]
    if (pluginHandle === null || pluginHandle === undefined ||
      pluginHandle.wechatStuff === null || pluginHandle.wechatStuff === undefined) {
      Janus.warn('Invalid handle')
      return 'Invalid handle'
    }
    var config = pluginHandle.wechatStuff
    if (config.pc === null || config.pc === undefined) {
      return 'Invalid PeerConnection'
    }
    // Start getting the bitrate, if getStats is supported
    if (config.pc.getStats) {
      if (config.bitrate.timer === null || config.bitrate.timer === undefined) {
        Janus.log('Starting bitrate timer (via getStats)')
        config.bitrate.timer = setInterval(function () {
          config.pc.getStats()
            .then(function (stats) {
              stats.forEach(function (res) {
                if (!res) {
                  return
                }
                var inStats = false
                // Check if these are statistics on incoming media
                if ((res.mediaType === 'video' || res.id.toLowerCase().indexOf('video') > -1) &&
                  res.type === 'inbound-rtp' && res.id.indexOf('rtcp') < 0) {
                  // New stats
                  inStats = true
                } else if (res.type == 'ssrc' && res.bytesReceived &&
                  (res.googCodecName === 'VP8' || res.googCodecName === '')) {
                  // Older Chromer versions
                  inStats = true
                }
                // Parse stats now
                if (inStats) {
                  config.bitrate.bsnow = res.bytesReceived
                  config.bitrate.tsnow = res.timestamp
                  if (config.bitrate.bsbefore === null || config.bitrate.tsbefore === null) {
                    // Skip this round
                    config.bitrate.bsbefore = config.bitrate.bsnow
                    config.bitrate.tsbefore = config.bitrate.tsnow
                  } else {
                    // Calculate bitrate
                    var timePassed = config.bitrate.tsnow - config.bitrate.tsbefore
                    var bitRate = Math.round((config.bitrate.bsnow - config.bitrate.bsbefore) * 8 / timePassed)
                    config.bitrate.value = bitRate + ' kbits/sec'
                    //~ Janus.log("Estimated bitrate is " + config.bitrate.value);
                    config.bitrate.bsbefore = config.bitrate.bsnow
                    config.bitrate.tsbefore = config.bitrate.tsnow
                  }
                }
              })
            })
        }, 1000)
        return '0 kbits/sec' // We don't have a bitrate value yet
      }
      return config.bitrate.value
    } else {
      Janus.warn('Getting the video bitrate unsupported by browser')
      return 'Feature unsupported by browser'
    }
  }

  function cleanupWechat (handleId, hangupRequest) {
    Janus.log('Cleaning WeChat stuff')
    var pluginHandle = pluginHandles[handleId]
    if (pluginHandle === null || pluginHandle === undefined) {
      // Nothing to clean
      return
    }
    var config = pluginHandle.wechatStuff
    if (config !== null && config !== undefined) {
      if (hangupRequest === true) {
        // Send a hangup request (we don't really care about the response)
        var request = {
          'janus': 'hangup',
          'transaction': Janus.randomString(12)
        }
        if (pluginHandle.token !== null && pluginHandle.token !== undefined) {
          request['token'] = pluginHandle.token
        }
        if (apisecret !== null && apisecret !== undefined) {
          request['apisecret'] = apisecret
        }
        Janus.debug('Sending hangup request (handle=' + handleId + '):')
        Janus.debug(request)
        if (websockets) {
          request['session_id'] = sessionId
          request['handle_id'] = handleId
          ws.send({
            data: JSON.stringify(request)
          })
        } else {
          Janus.httpAPICall(server + '/' + sessionId + '/' + handleId, {
            verb: 'POST',
            withCredentials: withCredentials,
            body: request
          })
        }
      }
      // Cleanup stack
      config.remoteStream = null
      if (config.volume) {
        if (config.volume['local'] && config.volume['local'].timer) {
          clearInterval(config.volume['local'].timer)
        }
        if (config.volume['remote'] && config.volume['remote'].timer) {
          clearInterval(config.volume['remote'].timer)
        }
      }
      config.volume = {}
      if (config.bitrate.timer) {
        clearInterval(config.bitrate.timer)
      }
      config.bitrate.timer = null
      config.bitrate.bsnow = null
      config.bitrate.bsbefore = null
      config.bitrate.tsnow = null
      config.bitrate.tsbefore = null
      config.bitrate.value = null
      config.myStream = null
      // Close PeerConnection
      try {
        config.pc.close()
      } catch (e) {
        // Do nothing
      }
      config.pc = null
      config.dataChannel = {}
      config.dtmfSender = null
    }
    pluginHandle.oncleanup()
  }

  // Helper methods to parse a media object
  function isAudioSendEnabled (media) {
    Janus.debug('isAudioSendEnabled:', media)
    if (media === undefined || media === null) {
      return true
    } // Default
    if (media.audio === false) {
      return false
    } // Generic audio has precedence
    if (media.audioSend === undefined || media.audioSend === null) {
      return true
    } // Default
    return (media.audioSend === true)
  }

  function isAudioSendRequired (media) {
    Janus.debug('isAudioSendRequired:', media)
    if (media === undefined || media === null) {
      return false
    } // Default
    if (media.audio === false || media.audioSend === false) {
      return false
    } // If we're not asking to capture audio, it's not required
    if (media.failIfNoAudio === undefined || media.failIfNoAudio === null) {
      return false
    } // Default
    return (media.failIfNoAudio === true)
  }

  function isAudioRecvEnabled (media) {
    Janus.debug('isAudioRecvEnabled:', media)
    if (media === undefined || media === null) {
      return true
    } // Default
    if (media.audio === false) {
      return false
    } // Generic audio has precedence
    if (media.audioRecv === undefined || media.audioRecv === null) {
      return true
    } // Default
    return (media.audioRecv === true)
  }

  function isVideoSendEnabled (media) {
    Janus.debug('isVideoSendEnabled:', media)
    if (media === undefined || media === null) {
      return true
    } // Default
    if (media.video === false) {
      return false
    } // Generic video has precedence
    if (media.videoSend === undefined || media.videoSend === null) {
      return true
    } // Default
    return (media.videoSend === true)
  }

  function isVideoSendRequired (media) {
    Janus.debug('isVideoSendRequired:', media)
    if (media === undefined || media === null) {
      return false
    } // Default
    if (media.video === false || media.videoSend === false) {
      return false
    } // If we're not asking to capture video, it's not required
    if (media.failIfNoVideo === undefined || media.failIfNoVideo === null) {
      return false
    } // Default
    return (media.failIfNoVideo === true)
  }

  function isVideoRecvEnabled (media) {
    Janus.debug('isVideoRecvEnabled:', media)
    if (media === undefined || media === null) {
      return true
    } // Default
    if (media.video === false) {
      return false
    } // Generic video has precedence
    if (media.videoRecv === undefined || media.videoRecv === null) {
      return true
    } // Default
    return (media.videoRecv === true)
  }

  function isScreenSendEnabled (media) {
    Janus.debug('isScreenSendEnabled:', media)
    if (media === undefined || media === null) {
      return false
    }
    if (typeof media.video !== 'object' || typeof media.video.mandatory !== 'object') {
      return false
    }
    var constraints = media.video.mandatory
    if (constraints.chromeMediaSource) {
      return constraints.chromeMediaSource === 'desktop' || constraints.chromeMediaSource === 'screen'
    } else if (constraints.mozMediaSource) {
      return constraints.mozMediaSource === 'window' || constraints.mozMediaSource === 'screen'
    } else if (constraints.mediaSource) {
      return constraints.mediaSource === 'window' || constraints.mediaSource === 'screen'
    }
    return false
  }

  function isDataEnabled (media) {
    Janus.debug('isDataEnabled:', media)
    if (media === undefined || media === null) {
      return false
    } // Default
    return (media.data === true)
  }
}
export default Janus
