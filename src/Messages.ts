/* tslint:disable:max-classes-per-file */

import { parseBody, MessageBodyType, BodyType } from './MessageBodyTypes';

export type CommuniqueType =
    | 'CreateRequest'
    | 'CreateResponse'
    | 'DeleteRequest'
    | 'DeleteResponse'
    | 'ExceptionResponse'
    | 'MetadataRequest'
    | 'MetadataResponse'
    | 'ReadRequest'
    | 'ReadResponse'
    | 'SubscribeRequest'
    | 'SubscribeResponse'
    | 'UnsubscribeRequest'
    | 'UnsubscribeResponse'
    | 'UpdateRequest'
    | 'UpdateResponse';

export interface ResponseHeaderJSON {
    MessageBodyType?: string;
    StatusCode?: string;
    Url?: string;
    ClientTag?: string;
}

export class ResponseHeader {
    public StatusCode?: ResponseStatus;
    public Url?: string;
    public MessageBodyType?: MessageBodyType;
    public ClientTag?: string;

    static fromJSON(json?: ResponseHeaderJSON): ResponseHeader {
        const status = json?.StatusCode === undefined ? undefined : ResponseStatus.fromString(json.StatusCode);

        return Object.assign({}, json, {
            StatusCode: status,
            MessageBodyType: json?.MessageBodyType as MessageBodyType,
        });
    }
}

export interface ResponseJSON {
    CommuniqueType: CommuniqueType;
    Header: ResponseHeaderJSON;
    Body: object;
}

export class Response {
    public CommuniqueType?: CommuniqueType;
    public Body?: BodyType;
    public Header: ResponseHeader;

    constructor() {
        this.Header = new ResponseHeader();
    }

    static fromJSON(json: ResponseJSON): Response {
        const header = ResponseHeader.fromJSON(json.Header);
        return Object.assign(new Response(), json, {
            Header: header,
            Body: header.MessageBodyType ? parseBody(header.MessageBodyType, json.Body) : undefined,
        });
    }
}

export type ResponseWithTag = { response: Response; tag: string };

export class ResponseStatus {
    constructor(public message: string, public code?: number) {}

    static fromString(s: string): ResponseStatus {
        const parts = s.split(' ', 2);
        if (parts.length === 1) {
            return new ResponseStatus(s);
        }

        const code = parseInt(parts[0], 10);
        if (Number.isNaN(code)) {
            return new ResponseStatus(s);
        }

        return new ResponseStatus(parts[1], code);
    }

    public toJSON(): string {
        return `${this.code} ${this.message}`;
    }

    public isSuccessful(): boolean {
        return this.code !== undefined && this.code >= 200 && this.code < 300;
    }
}
