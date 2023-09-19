// Token acquisition flow:
// 1. Load p.js javascript
// 2. Wait for `kpsdk-load` event
// 3. Call `window.KPSDK.configure`
// 4. Wait for `kpsdk-ready` event
// 5. Fetch `gql.twitch.tv/integrity` (p.js hijacks `fetch` to add PoW headers)
// 6. Token should be in `token` field of response, seems to be "Paseto Version 4" format.
//    We want `is_bad_bot` field in the decoded token to be false.

(()=>{
  const KPSDKToken = new Promise((resolve, reject) => {
    const sandboxedScript = () => {
      const CLIENT_ID     = 'kimne78kx3ncx6brgo4mv6wki5h1ko',
            SCRIPT_SOURCE = 'https://k.twitchcdn.net/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/p.js';
      const TokenFetcherStates = {
        INIT:           Symbol('INIT'),
        HELLO:          Symbol('HELLO'),
        REQUEST_WAIT:   Symbol('REQUEST_WAIT'),
        REQUEST:        Symbol('REQUEST'),
        DONE:           Symbol('DONE'),
      };
      const TokenFetcherCommands = {
        HELLO:          'hello',
        TOKEN_REQUEST:  'token_request',
        TOKEN_RESPONSE: 'token_response',
        GOODBYE:        'goodbye',
      };
      const TokenFetcher = {
        port:  null,
        state: TokenFetcherStates.INIT,
        transitions: {
          [TokenFetcherStates.INIT]:    [TokenFetcherCommands.HELLO],
          [TokenFetcherStates.HELLO]:   [TokenFetcherCommands.TOKEN_REQUEST],
          [TokenFetcherStates.REQUEST]: [TokenFetcherCommands.GOODBYE],
        },
        handlers: {
          [TokenFetcherCommands.HELLO](event) {
            if (self === parent || event?.source !== parent) return;
      
            const msg = this.ParseMessage(event.data, TokenFetcherCommands.HELLO);
            if (!msg) return;
      
            this.port = event.ports?.[0];
            if (!this.port) return;
      
            this.state = TokenFetcherStates.HELLO;
            this.port.onmessage = (e) => this.HandleMessage(e);
            this.port.postMessage({ command: TokenFetcherCommands.HELLO });
          },
          [TokenFetcherCommands.TOKEN_REQUEST](event) {
            if (event?.target !== this.port) return;
            
            const msg = this.ParseMessage(event.data, TokenFetcherCommands.TOKEN_REQUEST);
            if (!msg) return;

            const opts = msg.data;
            this.state = TokenFetcherStates.REQUEST_WAIT;
            const response = { command: TokenFetcherCommands.TOKEN_RESPONSE };
            this.FetchToken(opts)
            .then((token) => {
              response.data = { success: true, token: token };
            })
            .catch((error) => {
              response.data = { success: false, error: error };
            })
            .finally(() => {
              this.state = TokenFetcherStates.REQUEST;
              this.port.postMessage(response);
            });
          },
          [TokenFetcherCommands.GOODBYE](event) {
            if (event?.target !== this.port) return;

            const msg = this.ParseMessage(event.data, TokenFetcherCommands.GOODBYE);
            if (!msg) return;

            this.state = TokenFetcherStates.DONE;

            this.port.postMessage({ command: TokenFetcherCommands.GOODBYE });
            this.port.close();
          },
        },
        ParseMessage(data, command) {
          if (!data) return;
          if (command && data.command !== command) return;

          return data;
        },
        HandleMessage(event) {
          const msg = this.ParseMessage(event.data);
          const command = msg?.command;
          if (!command) return;

          const stateHandlers = this.transitions[this.state];
          if (!stateHandlers) return;

          const handler = this.handlers[stateHandlers.find((c) => c === command)];
          if (!handler) return;

          handler.call(this, event);
        },
        FetchToken(opts) {
          return new Promise((resolve, reject) => {
            const scriptElem = document.createElement('script');
            scriptElem.addEventListener('error', () => {
              reject(new Error(`error loading script "${SCRIPT_SOURCE}"`));
            });
            scriptElem.src = SCRIPT_SOURCE;

            document.addEventListener('kpsdk-load', () => {
              this.ConfigureKPSDK();
            }, { once: true });

            document.addEventListener('kpsdk-ready', () => {
              this.FetchIntegrity(opts)
              .then(resolve, reject);
            }, { once: true });

            document.body.appendChild(scriptElem);
            scriptElem.remove();
          });
        },
        ConfigureKPSDK() {
          const o = [
            {
              protocol: 'https:',
              method: 'POST',
              domain: 'gql.twitch.tv',
              path: '/integrity',
            },
          ];
    
          window.KPSDK.configure(o);
        },
        GetUniqueID() {
          return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
            .replace(/x/g, function () {
              return ((16 * Math.random()) | 0).toString(16);
            })
            .substring(0, 16);
        },
        async FetchIntegrity(opts) {
          opts = opts || {};
          const headers = {
            'client-id': opts.client_id || CLIENT_ID,
            'x-device-id': opts.device_id || this.GetUniqueID(),
            ...(opts.auth_token && { Authorization: 'OAuth ' + opts.auth_token }),
          };
          const resp = await fetch('https://gql.twitch.tv/integrity', {
            headers: headers,
            body: null,
            method: 'POST',
            mode: 'cors',
            credentials: 'omit',
          });
    
          if (resp.status !== 200) {
            throw new Error(`expected http status code 200, got ${resp.status}`);
          }
    
          return await resp.json();
        },
      };

      window.addEventListener('message', (e) => TokenFetcher.HandleMessage(e));
    };

    const TokenRequesterStates = {
      INIT:          Symbol('INIT'),
      FRAME_WAIT:    Symbol('FRAME_WAIT'),
      FRAME:         Symbol('FRAME'),
      CHANNEL:       Symbol('CHANNEL'),
      HELLO:         Symbol('HELLO'),
      RESPONSE:      Symbol('RESPONSE'),
      DONE:          Symbol('DONE'),
    };
    const TokenRequesterCommands = {
      LOAD_FRAME:     'load_frame',
      SETUP_CHANNEL:  'setup_channel',
      HELLO:          'hello',
      TOKEN_REQUEST:  'token_request',
      TOKEN_RESPONSE: 'token_response',
      GOODBYE:        'goodbye',
    };
    const TokenRequester = {
      port:  null,
      frame: null,
      state: TokenRequesterStates.INIT,
      transitions: {
        [TokenRequesterStates.INIT]:     [TokenRequesterCommands.LOAD_FRAME],
        [TokenRequesterStates.FRAME]:    [TokenRequesterCommands.SETUP_CHANNEL],
        [TokenRequesterStates.CHANNEL]:  [TokenRequesterCommands.HELLO],
        [TokenRequesterStates.HELLO]:    [TokenRequesterCommands.TOKEN_RESPONSE],
        [TokenRequesterStates.RESPONSE]: [TokenRequesterCommands.GOODBYE],
      },
      handlers: {
        [TokenRequesterCommands.LOAD_FRAME](event) {
          this.frame = this.CreateFrame(sandboxedScript);
          this.state = TokenRequesterStates.FRAME_WAIT;
          this.frame.addEventListener('load', () => {
            this.state = TokenRequesterStates.FRAME;
            this.HandleMessage({
              data: { command: TokenRequesterCommands.SETUP_CHANNEL }
            });
          });
          document.body.appendChild(this.frame);
        },
        [TokenRequesterCommands.SETUP_CHANNEL](event) {
          const channel = new MessageChannel();
          this.port = channel.port1;
          this.port.onmessage = (e) => this.HandleMessage(e);
          this.state = TokenRequesterStates.CHANNEL;
          this.frame.contentWindow.postMessage({ command: TokenRequesterCommands.HELLO }, '*', [channel.port2]);
        },
        [TokenRequesterCommands.HELLO](event) {
          if (event?.target !== this.port) return;

          const msg = this.ParseMessage(event.data, TokenRequesterCommands.HELLO);
          if (!msg) return;

          this.state = TokenRequesterStates.HELLO;
          this.port.postMessage({ command: TokenRequesterCommands.TOKEN_REQUEST, data: this.GetOptions() });
        },
        [TokenRequesterCommands.TOKEN_RESPONSE](event) {
          if (event?.target !== this.port) return;

          const msg = this.ParseMessage(event.data, TokenRequesterCommands.TOKEN_RESPONSE);
          if (!msg) return;

          this.state = TokenRequesterStates.RESPONSE;
          this.port.postMessage({ command: TokenRequesterCommands.GOODBYE });

          const response = msg.data;
      
          if (!response?.success) {
            return reject(response.error);
          }
          return resolve(response.token);
        },
        [TokenRequesterCommands.GOODBYE](event) {
          if (event?.target !== this.port) return;

          const msg = this.ParseMessage(event.data, TokenRequesterCommands.GOODBYE);
          if (!msg) return;

          this.state = TokenRequesterStates.DONE;

          this.frame.remove();
          this.port.close();
        },
      },
      ParseMessage(data, command) {
        if (!data) return;
        if (command && data.command !== command) return;

        return data;
      },
      HandleMessage(event) {
        const msg = this.ParseMessage(event.data);
        const command = msg?.command;
        if (!command) return;

        const stateHandlers = this.transitions[this.state];
        if (!stateHandlers) return;

        const handler = this.handlers[stateHandlers.find((c) => c === command)];
        if (!handler) return;

        handler.call(this, event);
      },
      GetOptions() {
        const url = new URL(location.href);
        const params = new URLSearchParams(url.hash.slice(1));
        return {
          device_id:  params.get('device_id'),
          auth_token: params.get('auth_token'),
          client_id:  params.get('client_id'),
        };
      },
      CreateFrame(script) {
        const d = document.implementation.createHTMLDocument();
    
        const scriptElement = document.createElement('script');
        const scriptTextNode = document.createTextNode(`(${script.toString()})()`);
        scriptElement.appendChild(scriptTextNode);
    
        d.body.appendChild(scriptElement);
    
        const f = document.createElement('iframe');
        f.id = 'script_frame';
        f.sandbox = 'allow-scripts allow-same-origin';
        f.src = 'data:text/html;base64,' + btoa(d.documentElement.outerHTML);
        f.style.width = '0px';
        f.style.height = '0px';
        f.style.border = '0px none';
        f.style.display = 'none';
        return f;
      },
      RequestToken() {
        this.HandleMessage({
          data: { command: TokenRequesterCommands.LOAD_FRAME }
        });
      },
    };

    TokenRequester.RequestToken();
  });

  // https://github.com/paseto-standard/paseto-spec/blob/master/docs/01-Protocol-Versions/Version4.md
  function parseToken(token) {
    const PREFIX = 'v4.public.';
    if (!token.startsWith(PREFIX)) {
      throw new Error(`expected token to start with "${PREFIX}": ${token}"`);
    }

    let tokenPayloadB64 = token.slice(PREFIX.length).replaceAll('-', '+').replaceAll('_', '/');
    tokenPayloadB64 = tokenPayloadB64.padEnd(tokenPayloadB64.length + ((4 - (tokenPayloadB64.length % 4)) % 4), '=');

    const tokenPayload = atob(tokenPayloadB64).slice(0, -64);

    return JSON.parse(tokenPayload);
  }

  async function main() {
    try {
      const token = await KPSDKToken;
      if (self !== parent) {
        parent.postMessage(token, '*');
      }
      const parsedToken = parseToken(token.token);
      document.getElementById('token').innerText = JSON.stringify(token, null, 2);
      document.getElementById('parsed').innerText = JSON.stringify(parsedToken, null, 2);
    } catch (err) {
      document.getElementById('error').innerText = err;
    }
  }

  main();
})();