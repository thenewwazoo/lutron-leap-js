import debug from 'debug';

import { Response } from './Messages';
import { EventEmitter } from 'events';
import TypedEmitter from 'typed-emitter';

const logDebug = debug('leap:responseparser');

type ResponseEvents = {
    response: (response: Response) => void;
};

export class ResponseParser extends (EventEmitter as new () => TypedEmitter<ResponseEvents>) {
    private buffer = '';

    public handleData(data: string): void {
        logDebug('handling data', data);
        logDebug('buffer is', this.buffer);

        data = this.buffer + data;

        const lines: string[] = data.split(/\r?\n/);
        const len = lines.length - 1;
        if (!len) {
            // didn't get a full line.
            logDebug("buffer doesn't contain a full line");
            this.buffer = data;
            return;
        }

        this.buffer = lines[len] || '';

        for (const line of lines.slice(0, len)) {
            try {
                logDebug('parsing line', line);
                const response = Response.fromJSON(JSON.parse(line));
                this.emit('response', response);
            } catch (e) {
                logDebug('malformed response:', e, ' caused by', line);
            }
        }
    }
}
