import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../httpClient.js';
import { type CustomerMessage, Message } from '../message.js';

const message = {
	encode: () => "HNHBK:1:3'",
	toString: () => 'HNHBK',
} as unknown as CustomerMessage;

describe('HttpClient with an undecodable response', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('does not print the response (it holds account data) unless debugging', async () => {
		const secret = "HIRMG:3:2+0010::Saldo 1.234,56 Max Mustermann DE99'";
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockImplementation(
					async () => new Response(Buffer.from(`garbage${secret}`, 'latin1').toString('base64')),
				),
		);
		vi.spyOn(Message, 'decode').mockImplementation(() => {
			throw new Error('cannot decode');
		});
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(new HttpClient('http://bank.example').sendMessage(message)).rejects.toThrow(
			'cannot decode',
		);
		expect(errors).not.toHaveBeenCalled();

		await expect(new HttpClient('http://bank.example', true).sendMessage(message)).rejects.toThrow(
			'cannot decode',
		);
		expect(errors).toHaveBeenCalled();
	});
});
