import { describe, expect, it } from 'vitest';
import { Language } from '../codes.js';
import { CustomerMessage, Message } from '../message.js';
import { HIRMG } from '../segments/HIRMG.js';
import { HIRMS, type HIRMSSegment } from '../segments/HIRMS.js';
import { HKIDN, type HKIDNSegment } from '../segments/HKIDN.js';
import { HKVVB, type HKVVBSegment } from '../segments/HKVVB.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

describe('Message', () => {
	describe('decoding', () => {
		it('with known segments', () => {
			const message = Message.decode(
				"HNHBK:1:3+000000000108+300+0+1'HKIDN:2:2+280:12030000+9999999999+0+0'HKVVB:3:3+0+0+0+ABCDEF+1.0'HNHBS:4:1+1'",
			);

			expect(message.segments.length).toBe(4);
		});

		it('with one unknown segment', () => {
			const message = Message.decode(
				"HNHBK:1:3+000000000108+300+0+1'HKIDN:2:2+280:12030000+9999999999+0+0'HKVVB:3:3+0+0+0+ABCDEF+1.0'HIXXX:4:1+13'HNHBS:5:1+1'",
			);

			expect(message.segments.length).toBe(5);
		});

		it('with signed and encrypted data', () => {
			const text =
				"HNHBK:1:3+000000000412+300+0+1'HNVSK:998:3+PIN:1+998+1+1+1:20240601:102151+2:2:13:@8@00000000:5:1+280:123456:user1:S:0:0+0'HNVSD:999:1+@259@HNSHK:2:4+PIN:2+944+1+1+1+1::rWkyTQV5yI8BAABFH0nthrBCCgQA+1+1:20240601:102151+1:3:1+6:10:16+280:30520037:user1:S:0:0'HKIDN:3:2+280:123456+user1+rWkyTQV5yI8BAABFH0nthrBCCgQA+1'HKVVB:4:3+43+9+0+9FA6681DEC0CF3046BFC2F8A6+0.1'HKTAN:5:6+4+HKIDN'HNSHA:6:2+1++12345''HNHBS:7:1+1'";

			const message = Message.decode(text);
			const hkidn = message.findSegment<HKIDNSegment>(HKIDN.Id);

			expect(hkidn?.customerId).toBe('user1');
			expect(hkidn?.bank.bankId).toBe('123456');
		});
	});

	describe('findAllSegments()', () => {
		it('returns all segments with given ID', () => {
			const hirmg = {
				header: { segId: HIRMG.Id, segNr: 1, version: HIRMG.Version },
				answers: [{ code: 20, text: 'Message 1' }],
			};
			const hirms1 = {
				header: { segId: HIRMS.Id, segNr: 2, version: HIRMS.Version },
				answers: [{ code: 30, text: 'Message 2' }],
			};
			const hirms2 = {
				header: { segId: HIRMS.Id, segNr: 3, version: HIRMS.Version },
				answers: [{ code: 40, text: 'Message 3' }],
			};

			const message = new Message([hirmg, hirms1, hirms2]);

			const segments = message.findAllSegments<HIRMSSegment>(HIRMS.Id);

			expect(segments.length).toBe(2);
			expect(segments.map((s) => s.header.segId)).toEqual([HIRMS.Id, HIRMS.Id]);
		});
	});
});

describe('CustomerMessage', () => {
	const hkidn: HKIDNSegment = {
		header: { segId: HKIDN.Id, segNr: 0, version: HKIDN.Version },
		bank: { country: 280, bankId: '12030000' },
		customerId: '9999999999',
		systemId: '0',
		systemIdRequired: 0,
	};

	const hkvvb: HKVVBSegment = {
		header: { segId: HKVVB.Id, segNr: 0, version: HKVVB.Version },
		bpdVersion: 0,
		updVersion: 0,
		dialogLanguage: Language.Default,
		productId: 'ABCDEF',
		productVersion: '1.0',
	};

	it('with no signature encodes correctly', () => {
		const message = new CustomerMessage('0', 1);

		message.addSegment(hkidn);
		message.addSegment(hkvvb);
		const encodedMessage = message.encode();

		expect(encodedMessage).toBe(
			"HNHBK:1:3+000000000108+300+0+1'HKIDN:2:2+280:12030000+9999999999+0+0'HKVVB:3:3+0+0+0+ABCDEF+1.0'HNHBS:4:1+1'",
		);
	});

	it('with signature encodes correctly', () => {
		const customerMessage = new CustomerMessage('0', 1);

		customerMessage.addSegment(hkidn);
		customerMessage.addSegment(hkvvb);
		customerMessage.sign(280, '12030000', '12345678', '123', '0', 900, '12345');
		const encodedMessage = customerMessage.encode();

		const _message = Message.decode(encodedMessage);
	});
});
