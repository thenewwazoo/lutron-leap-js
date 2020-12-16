'use strict';

// eslint-disable-next-line
const EventEmitter = require('events');
// eslint-disable-next-line
const debug = require('debug');
const log_debug = debug('leap:mock:tls');

const tls = jest.createMockFromModule('tls');

class MockedSocket extends EventEmitter {
    write(s, cb) {
        log_debug('written to mocked socket: ', s);
        writtenData.push(s);
        cb();
    }
}

let theSocket = new MockedSocket();
let writtenData = [];

function connect(port, host, options) {
    log_debug('mocked connect called. host: ', host, ', port: ', port, ', options: ', options);
    if (theSocket === undefined) {
        log_debug('creating socket singleton');
        theSocket = new MockedSocket();
    }
    return theSocket;
}

function __secureConnect() {
    log_debug('emitting secureConnect');
    theSocket.emit('secureConnect');
}

function __tickle(s) {
    log_debug('tickling the socket with data: ', s);
    theSocket.emit('data', Buffer.from(s));
}

function __tellme() {
    return writtenData;
}

tls.connect = connect;
tls.__secureConnect = __secureConnect;
tls.__tickle = __tickle;
tls.__tellme = __tellme;

module.exports = {
    MockedSocket,
    __secureConnect,
    __tickle,
    __tellme,
    theSocket,
};
