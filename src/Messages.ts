type CommuniqueType = string;

export interface ResponseJSON {
    CommuniqueType: CommuniqueType;
    Header: ResponseHeaderJSON;
    Body: any;
}

export class Response {
    public CommuniqueType?: CommuniqueType;
    public Body?: any;
    public Header: ResponseHeader;

    static fromJSON(json: ResponseJSON): Response {
        return Object.assign({}, json, {
            Header: ResponseHeader.fromJSON(json.Header),
        });
    }
}

export interface ResponseHeaderJSON {
    MessageBodyType?: string;
    StatusCode?: string;
    Url?: string;
    ClientTag?: string;
}

export class ResponseHeader {
    public StatusCode: ResponseStatus;
    public Url?: string;
    public MessageBodyType?: string;
    public ClientTag?: string;

    static fromJSON(json: ResponseHeaderJSON): ResponseHeader {
        if (json === undefined) {
            return new ResponseHeader();
        }

        const status = json.StatusCode === undefined ? undefined : ResponseStatus.fromString(json.StatusCode);

        return Object.assign({}, json, {
            StatusCode: status,
        });
    }
}

export class ResponseStatus {
    constructor(public message: string, public code?: number) {}

    static fromString(s?: string): ResponseStatus {
        const parts = s.split(' ', 2);
        if (parts.length == 1) {
            return new ResponseStatus(s);
        }

        const code = parseInt(parts[0]);
        if (Number.isNaN(code)) {
            return new ResponseStatus(s);
        }

        return new ResponseStatus(parts[1], code);
    }

    public isSuccessful(): boolean {
        return this.code !== undefined && this.code >= 200 && this.code < 300;
    }
}
