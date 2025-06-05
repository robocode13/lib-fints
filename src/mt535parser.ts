export interface StatementOfHoldings {
  totalValue?: number;
  currency?: string;
  holdings: Holding[];
}

export interface Holding {
  isin?: string;
  wkn?: string;
  name?: string;
  amount?: number;
  price?: number;
  currency?: string;
  value?: number;
  acquisitionPrice?: number;
  date?: Date;
  time?: Date;
}

export enum TokenType535 {
  DepotValueBlock = 'DepotValueBlock',
  DepotValueCurrency = 'DepotValueCurrency',
  FinBlock = 'FinBlock',
  SecurityIdentification = 'SecurityIdentification',
  AcquisitionPrice = 'AcquisitionPrice',
  PriceBlock = 'PriceBlock',
  AmountBlock = 'AmountBlock',
  DateTimeBlock = 'DateTimeBlock',
  DateString = 'DateString',
  TimeString = 'TimeString',
}

const tokens535: { [key in TokenType535]: RegExp } = {
  [TokenType535.DepotValueBlock]: /:16R:ADDINFO(.*?):16S:ADDINFO/ms,
  [TokenType535.DepotValueCurrency]: /EUR(.*)/ms,
  [TokenType535.FinBlock]: /:16R:FIN(.*?):16S:FIN/gms,
  [TokenType535.SecurityIdentification]: /^:35B:(.*?):/ms,
  [TokenType535.AcquisitionPrice]:
    /:70E::HOLD\/\/\d*STK2(\d*),(\d*)\+([A-Z]{3})/ms,
  [TokenType535.PriceBlock]: /:90([AB])::(.*?):/ms,
  [TokenType535.AmountBlock]: /:93B::(.*?):/ms,
  [TokenType535.DateTimeBlock]: /:98([AC])::(.*?):/ms,
  [TokenType535.DateString]: /(\d{4})(\d{2})(\d{2})/,
  [TokenType535.TimeString]: /^.{14}(\d{2})(\d{2})(\d{2})/ms,
};

export class Mt535Parser {
  private cleanedRawData: string;

  constructor(private rawData: string) {
    // The divider can be either \r\n or @@
    const crlfCount = (rawData.match(/\r\n-/g) || []).length;
    const atAtCount = (rawData.match(/@@-/g) || []).length;
    const divider = crlfCount > atAtCount ? '\r\n' : '@@';

    // Remove dividers that are not followed by a colon (tag indicator)
    const regex = new RegExp(divider + '([^:])', 'gms');
    this.cleanedRawData = rawData.replace(regex, '$1');
  }

  parse(): StatementOfHoldings {
    const result: StatementOfHoldings = {
      holdings: [],
    };

    // Parse total depot value
    result.totalValue = this.parseDepotValue();

    // Parse individual holdings
    result.holdings = this.parseHoldings();

    return result;
  }

  private parseDepotValue(): number | undefined {
    const addInfoMatch = this.cleanedRawData.match(
      tokens535[TokenType535.DepotValueBlock]
    );
    if (addInfoMatch) {
      const eurMatch = addInfoMatch[1].match(
        tokens535[TokenType535.DepotValueCurrency]
      );
      if (eurMatch) {
        return parseFloat(eurMatch[1].replace(',', '.'));
      }
    }
    return undefined;
  }

  private parseHoldings(): Holding[] {
    const holdings: Holding[] = [];

    const finBlocks = this.cleanedRawData.match(
      tokens535[TokenType535.FinBlock]
    );

    if (!finBlocks) {
      return holdings;
    }

    for (const block of finBlocks) {
      const holding = this.parseHolding(block);
      if (holding) {
        holdings.push(holding);
      }
    }

    return holdings;
  }

  private parseHolding(block: string): Holding {
    const holding: Holding = {};

    // Parse ISIN, WKN & Name from :35B:
    // :35B:ISIN DE0005190003/DE/519000BAY.MOTOREN WERKE AG ST
    this.parseSecurityIdentification(block, holding);

    // Parse acquisition price from :70E::HOLD//
    this.parseAcquisitionPrice(block, holding);

    // Parse current price from :90B: or :90A:
    this.parsePrice(block, holding);

    // Parse amount from :93B:
    this.parseAmount(block, holding);

    // Parse date/time from :98A: or :98C:
    this.parseDateTime(block, holding);

    // Calculate value if we have price and amount
    if (holding.amount !== undefined && holding.price !== undefined) {
      if (holding.currency === '%') {
        holding.value = holding.price / 100;
      } else {
        holding.value = holding.price * holding.amount;
      }
    }

    return holding;
  }

  private parseSecurityIdentification(block: string, holding: Holding): void {
    const match = block.match(tokens535[TokenType535.SecurityIdentification]);
    if (match) {
      const content = match[1];

      // ISIN: characters 5-16 (12 chars)
      const isinMatch = content.match(/^.{5}(.{12})/ms);
      if (isinMatch) {
        holding.isin = isinMatch[1];
      }

      // WKN: characters 21-26 (6 chars)
      const wknMatch = content.match(/^.{21}(.{6})/ms);
      if (wknMatch) {
        holding.wkn = wknMatch[1];
      }

      // Name: everything from character 27 onwards
      const nameMatch = content.match(/^.{27}(.*)/ms);
      if (nameMatch) {
        holding.name = nameMatch[1];
      }
    }
  }

  private parseAcquisitionPrice(block: string, holding: Holding): void {
    const match = block.match(tokens535[TokenType535.AcquisitionPrice]);
    if (match) {
      holding.acquisitionPrice = parseFloat(`${match[1]}.${match[2]}`);
      if (!holding.currency) {
        holding.currency = match[3];
      }
    }
  }

  private parsePrice(block: string, holding: Holding): void {
    const match = block.match(tokens535[TokenType535.PriceBlock]);
    if (match) {
      const type = match[1];
      const content = match[2];

      if (type === 'B') {
        // Currency from characters 11-13 (3 chars)
        const currencyMatch = content.match(/^.{11}(.{3})/ms);
        if (currencyMatch) {
          holding.currency = currencyMatch[1];
        }

        // Price from character 14 onwards
        const priceMatch = content.match(/^.{14}(.*)/ms);
        if (priceMatch) {
          holding.price = parseFloat(priceMatch[1].replace(',', '.'));
        }
      } else if (type === 'A') {
        holding.currency = '%';

        // Price from character 11 onwards
        const priceMatch = content.match(/^.{11}(.*)/ms);
        if (priceMatch) {
          holding.price = parseFloat(priceMatch[1].replace(',', '.')) / 100;
        }
      }
    }
  }

  private parseAmount(block: string, holding: Holding): void {
    const match = block.match(tokens535[TokenType535.AmountBlock]);
    if (match) {
      // Amount from character 11 onwards
      const amountMatch = match[1].match(/^.{11}(.*)/ms);
      if (amountMatch) {
        holding.amount = parseFloat(amountMatch[1].replace(',', '.'));
      }
    }
  }

  private parseDateTime(block: string, holding: Holding): void {
    const match = block.match(tokens535[TokenType535.DateTimeBlock]);
    if (match) {
      const type = match[1];
      const content = match[2];

      // Date from characters 6-13 (8 chars: YYYYMMDD)
      const dateMatch = content.match(tokens535[TokenType535.DateString]);
      if (dateMatch) {
        holding.date = this.parseDate(dateMatch[1]);

        const time = new Date();
        if (type === 'C') {
          // :98C: has a time component HHMMSS starting at character 14
          const timeMatch = content.match(tokens535[TokenType535.TimeString]);
          if (timeMatch) {
            time.setHours(
              parseInt(timeMatch[1]),
              parseInt(timeMatch[2]),
              parseInt(timeMatch[3])
            );
          }
        } else {
          time.setHours(0, 0, 0);
        }
        holding.time = time;
      }
    }
  }

  private parseDate(dateString: string): Date {
    const match = dateString.match(tokens535[TokenType535.DateString]);
    if (!match) {
      throw new Error(`Invalid date format: ${dateString}`);
    }

    try {
      return new Date(
        parseInt(match[1]),
        parseInt(match[2]) - 1,
        parseInt(match[3])
      );
    } catch (error) {
      throw new Error(`Invalid date: ${dateString}`, { cause: error });
    }
  }
}
