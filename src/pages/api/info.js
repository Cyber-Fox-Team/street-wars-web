import dgram from 'dgram';

export const prerender = false;

const HOST = '185.107.96.148';
const PORT = 7777;

const REQUEST_TIMEOUT_MS = 1500;
const SUCCESS_CACHE_TTL_MS = 5000;
const FAILURE_CACHE_TTL_MS = 8000;
const FAILURE_COOLDOWN_MS = 10000;

let statusCache = null;

let failureCooldownUntil = 0;

let inFlightQuery = null;

export async function GET() {
  const now = Date.now();

  if (statusCache && statusCache.expiresAt > now) {
    return json(statusCache.data, 200, { 'Cache-Control': 'no-store' });
  }

  if (failureCooldownUntil > now) {
    const offline = makeOfflineStatus('cooldown');
    statusCache = { data: offline, expiresAt: now + FAILURE_CACHE_TTL_MS };
    return json(offline, 200, { 'Cache-Control': 'no-store' });
  }

  try {
    if (!inFlightQuery) {
      inFlightQuery = query({ host: HOST, port: PORT, timeout: REQUEST_TIMEOUT_MS });
    }

    const data = await inFlightQuery;
    statusCache = { data, expiresAt: Date.now() + SUCCESS_CACHE_TTL_MS };
    failureCooldownUntil = 0;
    return json(data, 200, { 'Cache-Control': 'no-store' });
  } catch {
    failureCooldownUntil = Date.now() + FAILURE_COOLDOWN_MS;
    const offline = makeOfflineStatus('udp-unavailable');
    statusCache = { data: offline, expiresAt: Date.now() + FAILURE_CACHE_TTL_MS };
    return json(offline, 200, { 'Cache-Control': 'no-store' });
  } finally {
    inFlightQuery = null;
  }
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

function makeOfflineStatus(reason) {
  return {
    address: HOST,
    port: PORT,
    hostname: 'Los Santos Street Wars',
    gamemode: null,
    mapname: null,
    passworded: false,
    maxplayers: 0,
    online: 0,
    players: [],
    rules: {},
    status: 'offline',
    reason,
    fetchedAt: new Date().toISOString(),
  };
}

async function query(options) {
  if (typeof options === 'string') options = { host: options };
  options.port = options.port || PORT;
  options.timeout = options.timeout || REQUEST_TIMEOUT_MS;

  if (!options.host) {
    throw new Error('Invalid host');
  }

  if (!isFinite(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error('Invalid port');
  }

  const response = {};

  const information = await request(options, 'i');
  response.address = options.host;
  response.port = options.port;
  response.hostname = information.hostname;
  response.gamemode = information.gamemode;
  response.mapname = information.mapname;
  response.passworded = information.passworded === 1;
  response.maxplayers = information.maxplayers;
  response.online = information.players;
  response.status = 'online';
  response.fetchedAt = new Date().toISOString();

  let rules = {};
  try {
    rules = await request(options, 'r');
    rules.lagcomp = rules.lagcomp === 'On';
    rules.weather = parseInt(rules.weather, 10) || null;
  } catch {
    rules = {};
  }
  response.rules = rules;

  if (response.online > 100) {
    response.players = [];
    return response;
  }

  try {
    response.players = await request(options, 'd');
  } catch {
    response.players = [];
  }

  return response;
}

function request(options, opcode) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const packet = Buffer.alloc(10 + opcode.length);

    packet.write('SAMP');

    for (let i = 0; i < 4; ++i) packet[i + 4] = options.host.split('.')[i];

    packet[8] = options.port & 0xff;
    packet[9] = (options.port >> 8) & 0xff;
    packet[10] = opcode.charCodeAt(0);

    let settled = false;

    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(controller);
      socket.close();
      reject(error);
    };

    const settleResolve = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(controller);
      socket.close();
      resolve(value);
    };

    const controller = setTimeout(() => {
      settleReject(new Error('Host unavailable'));
    }, options.timeout);

    socket.once('error', (error) => {
      settleReject(error);
    });

    socket.on('message', (messageData) => {
      if (messageData.length < 11) {
        settleResolve(true);
        return;
      }

      const message = Buffer.from(messageData.subarray(11));

      const object = {};
      const array = [];
      let strlen = 0;
      let offset = 0;

      try {
        if (opcode === 'i') {
          object.passworded = message.readUInt8(offset);
          offset += 1;

          object.players = message.readUInt16LE(offset);
          offset += 2;

          object.maxplayers = message.readUInt16LE(offset);
          offset += 2;

          strlen = message.readUInt16LE(offset);
          offset += 4;

          object.hostname = decode(Buffer.from(message.subarray(offset, (offset += strlen))));

          strlen = message.readUInt16LE(offset);
          offset += 4;

          object.gamemode = decode(Buffer.from(message.subarray(offset, (offset += strlen))));

          strlen = message.readUInt16LE(offset);
          offset += 4;

          object.mapname = decode(Buffer.from(message.subarray(offset, (offset += strlen))));

          settleResolve(object);
          return;
        }

        if (opcode === 'r') {
          let rulecount = message.readUInt16LE(offset);
          offset += 2;

          while (rulecount) {
            strlen = message.readUInt8(offset);
            ++offset;

            const property = decode(Buffer.from(message.subarray(offset, (offset += strlen))));

            strlen = message.readUInt8(offset);
            ++offset;

            const value = decode(Buffer.from(message.subarray(offset, (offset += strlen))));

            object[property] = value;

            --rulecount;
          }

          settleResolve(object);
          return;
        }

        if (opcode === 'd') {
          let playercount = message.readUInt16LE(offset);
          offset += 2;

          while (playercount) {
            const player = {};

            player.id = message.readUInt8(offset);
            ++offset;

            strlen = message.readUInt8(offset);
            ++offset;

            player.name = decode(Buffer.from(message.subarray(offset, (offset += strlen))));

            player.score = message.readUInt32LE(offset);
            offset += 4;

            player.ping = message.readUInt32LE(offset);
            offset += 4;

            array.push(player);

            --playercount;
          }

          settleResolve(array);
          return;
        }

        settleResolve(true);
      } catch (exception) {
        settleReject(exception);
      }
    });

    try {
      socket.send(packet, 0, packet.length, options.port, options.host, (error) => {
        if (error) settleReject(error);
      });
    } catch (error) {
      settleReject(error);
    }
  });
}

function decode(buffer) {
  let charset = '';
  for (let i = 0; i < 128; i++) charset += String.fromCharCode(i);
  charset +=
    '€�‚ƒ„…†‡�‰�‹�����‘’“”•–—�™�›���� ΅Ά£¤¥¦§¨©�«¬­®―°±²³΄µ¶·ΈΉΊ»Ό½ΎΏΐΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡ�ΣΤΥΦΧΨΩΪΫάέήίΰαβγδεζηθικλμνξοπρςστυφχψωϊϋόύώ�';
  const charsetBuffer = Buffer.from(charset, 'ucs2');
  const decodeBuffer = Buffer.alloc(buffer.length * 2);
  for (let i = 0; i < buffer.length; i++) {
    decodeBuffer[i * 2] = charsetBuffer[buffer[i] * 2];
    decodeBuffer[i * 2 + 1] = charsetBuffer[buffer[i] * 2 + 1];
  }
  return decodeBuffer.toString('ucs2');
}
