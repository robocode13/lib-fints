import { FinTSConfig } from './config.js';
import { TanMediaRequirement } from './codes.js';
import { HttpClient } from './httpClient.js';
import { CustomerMessage, CustomerOrderMessage, Message } from './message.js';
import { SegmentWithContinuationMark } from './segment.js';
import { HKEND, HKENDSegment } from './segments/HKEND.js';
import { HKIDN } from './segments/HKIDN.js';
import { HKTAN, HKTANSegment } from './segments/HKTAN.js';
import { HNHBK, HNHBKSegment } from './segments/HNHBK.js';
import { decode } from './segment.js';
import { PARTED, PartedSegment } from './partedSegment.js';
import { ClientResponse, CustomerInteraction, CustomerOrderInteraction } from './interactions/customerInteraction.js';
import { InitDialogInteraction, InitResponse } from './interactions/initDialogInteraction.js';
import { HttpClientNode } from './httpClientNode.js';

export class Dialog {
  dialogId: string = '0';
  lastMessageNumber = 0;
  isInitialized = false;
  hasEnded = false;
  httpClient: HttpClient;

  constructor(public config: FinTSConfig) {
    if (!this.config) {
      throw new Error('configuration must be provided');
    }

    this.httpClient = this.getHttpClient();
  }

  async initialize(interaction: InitDialogInteraction): Promise<InitResponse> {
    if (this.isInitialized) {
      throw new Error('dialog has already been initialized');
    }

    if (this.hasEnded) {
      throw Error('cannot initialize a dialog that has already ended');
    }

    if (this.lastMessageNumber > 0) {
      throw new Error('dialog initialization must be the first message in a dialog');
    }

    interaction.dialog = this;
    this.lastMessageNumber++;
    const message = new CustomerMessage(this.dialogId, this.lastMessageNumber);

    const tanMethod = this.config.selectedTanMethod;
    const isScaSupported = tanMethod && tanMethod.version >= 6;

    if (this.config.userId && this.config.pin) {
      message.sign(
        this.config.countryCode,
        this.config.bankId,
        this.config.userId,
        this.config.pin,
        this.config.bankingInformation!.systemId,
        isScaSupported ? this.config.tanMethodId : undefined
      );
    }

    const segments = interaction.getSegments(this.config);
    segments.forEach((segment) => message.addSegment(segment));

    if (this.config.userId && this.config.pin && isScaSupported) {
      const hktan: HKTANSegment = {
        header: { segId: HKTAN.Id, segNr: 0, version: tanMethod.version },
        tanProcess: 4,
        segId: HKIDN.Id,
      };

      message.addSegment(hktan);
    }

    const initResponse = await this.httpClient.sendMessage(message);

    const clientResponse = interaction.getClientResponse<InitResponse>(initResponse);
    this.dialogId = clientResponse.dialogId;

    if (clientResponse.success) {
      this.isInitialized = true;
    }

    this.checkEnded(initResponse);

    return clientResponse;
  }

  async end(): Promise<boolean> {
    if (!this.isInitialized || this.hasEnded) {
      return true;
    }

    const tanMethod = this.config.selectedTanMethod;
    const isScaSupported = tanMethod && tanMethod.version >= 6;

    if (this.config.tanMethodId && !tanMethod) {
      throw new Error('given tanMethodId is not available according to the BPD');
    }

    this.lastMessageNumber++;
    const message = new CustomerMessage(this.dialogId, this.lastMessageNumber);

    if (this.config.userId && this.config.pin) {
      message.sign(
        this.config.countryCode,
        this.config.bankId,
        this.config.userId,
        this.config.pin,
        this.config.bankingInformation.systemId,
        isScaSupported ? this.config.tanMethodId : undefined
      );
    }

    const hkend: HKENDSegment = {
      header: { segId: HKEND.Id, segNr: 0, version: HKEND.Version },
      dialogId: this.dialogId,
    };

    message.addSegment(hkend);

    const responseMessage = await this.httpClient.sendMessage(message);

    this.checkEnded(responseMessage);
    return this.hasEnded;
  }

  async startCustomerOrderInteraction<TClientResponse extends ClientResponse>(
    interaction: CustomerOrderInteraction
  ): Promise<TClientResponse> {
    if (!this.isInitialized) {
      throw Error('dialog must be initialized before sending a customer order');
    }

    if (this.hasEnded) {
      throw Error('cannot send a customer message when dialog has already ended');
    }

    const bankTransaction = this.config.bankingInformation.bpd?.allowedTransactions.find(
      (t) => t.transId === interaction.segId
    );

    if (!bankTransaction) {
      throw Error(`transaction ${interaction.segId} is not supported according to the BPD`);
    }

    interaction.dialog = this;
    this.lastMessageNumber++;
    const message = new CustomerOrderMessage(
      interaction.segId,
      interaction.responseSegId,
      this.dialogId,
      this.lastMessageNumber
    );

    if (this.config.userId && this.config.pin) {
      message.sign(
        this.config.countryCode,
        this.config.bankId,
        this.config.userId,
        this.config.pin,
        this.config.bankingInformation.systemId,
        this.config.selectedTanMethod && (bankTransaction.tanRequired || this.config.selectedTanMethod.version >= 6)
          ? this.config.tanMethodId
          : undefined
      );
    }

    const segments = interaction.getSegments(this.config);
    segments.forEach((segment) => message.addSegment(segment));

    if (bankTransaction.tanRequired) {
      if (this.config.userId && this.config.pin && this.config.tanMethodId) {
        const hktan: HKTANSegment = {
          header: { segId: HKTAN.Id, segNr: 0, version: this.config.selectedTanMethod!.version },
          tanProcess: 4,
          segId: interaction.segId,
          tanMedia: this.config.tanMediaName,
        };

        message.addSegment(hktan);
      }
    }

    let responseMessage = await this.httpClient.sendMessage(message);

    let partedSegment = responseMessage.findSegment<PartedSegment>(PARTED.Id);

    if (partedSegment) {
      while (responseMessage.hasReturnCode(3040)) {
        const answers = responseMessage.getBankAnswers();
        const segmentWithContinuation = segments.find(
          (s) => s.header.segId === interaction.segId
        ) as SegmentWithContinuationMark;
        if (!segmentWithContinuation) {
          throw new Error(
            `Response contains segment with further information, but corresponding segment could not be found or is not specified`
          );
        }

        segmentWithContinuation.continuationMark = answers.find((a) => a.code === 3040)!.params![0];
        message.findSegment<HNHBKSegment>(HNHBK.Id)!.msgNr = ++this.lastMessageNumber;
        const nextResponseMessage = await this.httpClient.sendMessage(message);
        const nextPartedSegment = nextResponseMessage.findSegment<PartedSegment>(PARTED.Id);

        if (nextPartedSegment) {
          nextPartedSegment.rawData =
            partedSegment.rawData + nextPartedSegment.rawData.slice(nextPartedSegment.rawData.indexOf('+') + 1);
          partedSegment = nextPartedSegment;
        }

        responseMessage = nextResponseMessage;
      }

      const completeSegment = decode(partedSegment.rawData);
      const index = responseMessage.segments.indexOf(partedSegment);
      responseMessage.segments.splice(index, 1, completeSegment);
    }

    this.checkEnded(responseMessage);

    return interaction.getClientResponse<TClientResponse>(responseMessage);
  }

  async sendTanMessage(refSegId: string, tanOrderReference: string, tan: string): Promise<Message> {
    if (!refSegId || !tanOrderReference || !tan) {
      throw Error('refSegId, tanOrderReference and TAN must be provided to send a TAN message');
    }

    if (!this.isInitialized) {
      throw Error('dialog must be initialized before sending a TAN message');
    }

    if (this.hasEnded) {
      throw Error('cannot send a TAN message when dialog has alreay ended');
    }

    this.lastMessageNumber++;
    const message = new CustomerMessage(this.dialogId, this.lastMessageNumber);

    if (this.config.userId && this.config.pin) {
      message.sign(
        this.config.countryCode,
        this.config.bankId,
        this.config.userId,
        this.config.pin,
        this.config.bankingInformation!.systemId,
        this.config.tanMethodId,
        tan
      );
    }

    if (this.config.userId && this.config.pin && this.config.tanMethodId) {
      const hktan: HKTANSegment = {
        header: { segId: HKTAN.Id, segNr: 0, version: this.config.selectedTanMethod!.version },
        tanProcess: 2,
        segId: refSegId,
        orderRef: tanOrderReference,
        nextTan: false,
        tanMedia:
          this.config.selectedTanMethod!.tanMediaRequirement >= TanMediaRequirement.Optional
            ? this.config.tanMediaName
            : undefined,
      };

      message.addSegment(hktan);
    }

    const responseMessage = await this.httpClient.sendMessage(message);

    this.checkEnded(responseMessage);

    return responseMessage;
  }

  private checkEnded(initResponse: Message) {
    if (initResponse.hasReturnCode(100) || initResponse.hasReturnCode(9800)) {
      this.hasEnded = true;
    }
  }

  private getHttpClient(): HttpClient {
    if (typeof fetch === 'function') {
      return new HttpClient(this.config.bankingUrl, this.config.debugEnabled);
    } else {
      return new HttpClientNode(this.config.bankingUrl, this.config.debugEnabled);
    }
  }
}
