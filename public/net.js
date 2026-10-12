// Connexion WebSocket avec reconnexion automatique.
// connect('render' | 'control', { onMessage(msg), onStatus(connecté) }) -> { send(obj) }
function connect(role, handlers) {
  var ws = null;
  var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?role=' + role;

  function open() {
    ws = new WebSocket(url);
    ws.onopen = function () { handlers.onStatus && handlers.onStatus(true); };
    ws.onclose = function () {
      handlers.onStatus && handlers.onStatus(false);
      setTimeout(open, 1000);
    };
    ws.onmessage = function (e) {
      try { handlers.onMessage && handlers.onMessage(JSON.parse(e.data)); } catch (err) { /* message invalide ignoré */ }
    };
  }
  open();

  return {
    send: function (obj) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    }
  };
}
