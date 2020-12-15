
import { LeapClient } from './LeapClient';
import * as tls from 'tls';

jest.mock('tls');

test('construct', () => {
    let client = new LeapClient("foohost", 6666, "cafilestr", "keystr", "certstr");
});
