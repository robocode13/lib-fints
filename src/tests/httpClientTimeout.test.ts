import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../httpClient.js';
import type { CustomerMessage } from '../message.js';

const message = {
	encode: () => "HNHBK:1:3'",
	toString: () => 'HNHBK',
} as unknown as CustomerMessage;

describe('HttpClient.timeoutMs', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		HttpClient.timeoutMs = undefined;
	});

	it('waits without a timeout unless one is set', async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
		vi.stubGlobal('fetch', fetchMock);
		await expect(new HttpClient('http://bank.example').sendMessage(message)).rejects.toThrow(
			'offline',
		);
		expect(fetchMock.mock.calls[0][1].signal).toBeUndefined();
	});

	it('gives every request the timeout that was set', async () => {
		const fetchMock = vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
		vi.stubGlobal('fetch', fetchMock);
		HttpClient.timeoutMs = 30_000;
		await expect(new HttpClient('http://bank.example').sendMessage(message)).rejects.toThrow(
			'timed out',
		);
		expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
	});
});
