import debug from 'debug';

import { Response } from './Messages';
import { EventEmitter } from 'events';
import TypedEmitter from 'typed-emitter';

const log_debug = debug('responseparser');

interface ResponseEvents {
    'response': (response: Response) => void;
}

export class ResponseParser extends (EventEmitter as new () => TypedEmitter<ResponseEvents>) {
    private buffer: string = '';

    public handleData(data: string): void {
        log_debug("handling data ", data);
        log_debug("buffer is ", this.buffer);

        data = this.buffer + data;

        let lines: Array<string> = data.split(/\r?\n/);
        let len = lines.length - 1;
        if (!len) {
            // didn't get a full line.
            log_debug("buffer doesn't contain a full line");
            return;
        }

        this.buffer = lines[len] || '';

        for (let line of lines.slice(0, len)) {
            try {
                log_debug("parsing line ", line);
                const response = Response.fromJSON(JSON.parse(line));
                this.emit('response', response);
            } catch (e) {
                log_debug("malformed response: ", line);
            }
        }
    }
}
