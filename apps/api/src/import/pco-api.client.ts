import { BadRequestException, Injectable, Logger } from '@nestjs/common';

// Planning-Center-API-Import (optional, zusätzlich zum CSV-Weg):
// Die REST-API liefert mehr Struktur als der CSV-Export (saubere
// E-Mail-/Telefon-Objekte). Auth per Personal Access Token
// (App-ID + Secret, HTTP Basic).
//
// SSRF-Schutz: Die Basis-URL ist fest verdrahtet – es werden niemals
// nutzerdefinierte URLs abgerufen (siehe OWASP-Checkliste A10).
const PCO_BASE = 'https://api.planningcenteronline.com/people/v2/people';
const PAGE_SIZE = 100;
const MAX_PAGES = 100; // Schutz gegen Endlos-Pagination

// Zeilenformat mit kanonischen Headern: die Import-Pipeline behandelt
// API-Daten wie ein bereits perfekt gemapptes CSV
export interface PcoPersonRow {
  [key: string]: string;
}

interface PcoResponse {
  data: {
    id: string;
    attributes: {
      first_name?: string;
      last_name?: string;
      birthdate?: string;
      status?: string;
    };
    relationships?: {
      emails?: { data: { id: string }[] };
      phone_numbers?: { data: { id: string }[] };
    };
  }[];
  included?: {
    id: string;
    type: string;
    attributes: { address?: string; number?: string; primary?: boolean };
  }[];
  links?: { next?: string };
}

@Injectable()
export class PcoApiClient {
  private readonly logger = new Logger(PcoApiClient.name);

  async fetchPeople(appId: string, secret: string): Promise<PcoPersonRow[]> {
    const rows: PcoPersonRow[] = [];
    const auth = Buffer.from(`${appId}:${secret}`).toString('base64');
    let url: string | undefined = `${PCO_BASE}?per_page=${PAGE_SIZE}&include=emails,phone_numbers`;

    for (let page = 0; url && page < MAX_PAGES; page++) {
      const response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      if (response.status === 401) {
        throw new BadRequestException('Planning Center: Zugangsdaten ungültig');
      }
      if (!response.ok) {
        throw new BadRequestException(`Planning Center antwortete mit ${response.status}`);
      }
      const body = (await response.json()) as PcoResponse;

      // Included-Objekte (E-Mails/Telefone) per ID auflösen
      const includedById = new Map(
        (body.included ?? []).map((item) => [`${item.type}:${item.id}`, item.attributes]),
      );

      for (const person of body.data) {
        const emailRef = person.relationships?.emails?.data[0];
        const phoneRef = person.relationships?.phone_numbers?.data[0];
        rows.push({
          'First Name': person.attributes.first_name ?? '',
          'Last Name': person.attributes.last_name ?? '',
          Email: emailRef ? (includedById.get(`Email:${emailRef.id}`)?.address ?? '') : '',
          Phone: phoneRef ? (includedById.get(`PhoneNumber:${phoneRef.id}`)?.number ?? '') : '',
          Birthdate: person.attributes.birthdate ?? '',
          'PCO Status': person.attributes.status ?? '',
        });
      }

      // Nur PCO-eigenen next-Links folgen (feste Domain)
      url =
        body.links?.next && body.links.next.startsWith('https://api.planningcenteronline.com/')
          ? body.links.next
          : undefined;
    }

    this.logger.log(`PCO-API: ${rows.length} Personen geladen`);
    return rows;
  }
}
