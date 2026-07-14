import { parseSongFile, SongFileParseError } from './song-file-parser';

describe('parseSongFile', () => {
  describe('ChordPro', () => {
    const full = [
      '{title: In Christ Alone}',
      '{artist: Keith Getty | Stuart Townend}',
      '{key: D}',
      '{tempo: 72}',
      '{ccli: 3350395}',
      '{copyright: © 2001 Thankyou Music}',
      '',
      '{start_of_verse}',
      'In [D]Christ a[G]lone my [D]hope is [A]found',
      '{end_of_verse}',
    ].join('\n');

    it('liest alle Direktiven und behält die Quelle als lyrics', () => {
      const parsed = parseSongFile(full, 'in-christ-alone.cho');
      expect(parsed).toMatchObject({
        title: 'In Christ Alone',
        author: 'Keith Getty | Stuart Townend',
        key: 'D',
        tempoBpm: 72,
        ccliNumber: '3350395',
        copyright: '© 2001 Thankyou Music',
      });
      expect(parsed.lyrics).toContain('[D]Christ a[G]lone');
      expect(parsed.lyrics).toContain('{title: In Christ Alone}');
    });

    it('erkennt ChordPro auch an der Kurz-Direktive {t:} in .txt-Dateien', () => {
      const parsed = parseSongFile('{t: Minimal}\nNur eine Zeile', 'minimal.txt');
      expect(parsed.title).toBe('Minimal');
      expect(parsed.ccliNumber).toBeUndefined();
      expect(parsed.tempoBpm).toBeUndefined();
    });

    it('wirft bei fehlendem Titel', () => {
      expect(() => parseSongFile('{key: C}\nText', 'ohne-titel.cho')).toThrow(SongFileParseError);
    });
  });

  describe('SongSelect-Text', () => {
    const english = [
      '10,000 Reasons (Bless The Lord)',
      'Jonas Myrin | Matt Redman',
      '',
      'Chorus',
      'Bless the Lord O my soul',
      'O my soul',
      '',
      'Verse 1',
      'The sun comes up',
      '',
      'CCLI Song # 6016351',
      '© 2011 Atlas Mountain Songs',
      'For use solely with the SongSelect® Terms of Use. All rights reserved.',
      'www.ccli.com',
      'CCLI License # 123456',
    ].join('\r\n');

    it('liest Titel, Autoren, CCLI-Nummer, Copyright – ohne Boilerplate (CRLF)', () => {
      const parsed = parseSongFile(english, '10000-reasons.txt');
      expect(parsed).toMatchObject({
        title: '10,000 Reasons (Bless The Lord)',
        author: 'Jonas Myrin | Matt Redman',
        ccliNumber: '6016351',
        copyright: '© 2011 Atlas Mountain Songs',
      });
      expect(parsed.lyrics).toContain('Bless the Lord O my soul');
      expect(parsed.lyrics).toContain('Verse 1');
      expect(parsed.lyrics).not.toContain('SongSelect');
      expect(parsed.lyrics).not.toContain('CCLI');
      expect(parsed.lyrics).not.toContain('©');
    });

    it('versteht die deutsche Variante', () => {
      const german = [
        'Größer als alles',
        'Chris Tomlin',
        '',
        'Strophe 1',
        'Wasser wird Wein',
        '',
        'CCLI-Liednummer 5894919',
        '© 2010 sixsteps Music',
        'Zur Verwendung ausschliesslich gemäss den SongSelect-Nutzungsbedingungen.',
        'CCLI-Lizenznummer 987654',
      ].join('\n');
      const parsed = parseSongFile(german, 'groesser-als-alles.txt');
      expect(parsed.ccliNumber).toBe('5894919');
      expect(parsed.copyright).toBe('© 2010 sixsteps Music');
      expect(parsed.lyrics).toBe('Strophe 1\nWasser wird Wein');
    });

    it('behandelt Dateien ohne Autorenzeile (Songtext direkt nach Titel)', () => {
      const parsed = parseSongFile('Nur Titel\nVerse 1\nErste Zeile', 'kurz.txt');
      expect(parsed.title).toBe('Nur Titel');
      expect(parsed.author).toBeUndefined();
      expect(parsed.lyrics).toContain('Verse 1');
    });

    it('wirft bei leerer Datei', () => {
      expect(() => parseSongFile('\n  \n', 'leer.txt')).toThrow(SongFileParseError);
    });
  });
});
