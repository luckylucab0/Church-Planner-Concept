// Umrechnung zwischen ISO-Zeitstempeln (API) und den Werten, die
// <input type="datetime-local"> erwartet. Der Input arbeitet in lokaler
// Zeit ohne Zonen-Suffix – toISOString() würde also um den Offset
// verschieben, deshalb hier explizit über die lokalen Getter.

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function toLocalInput(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

// Endzeit-Vorschlag beim Anlegen: Start + Dauer in Minuten
export function addMinutes(localInput: string, minutes: number): string {
  const date = new Date(localInput);
  date.setMinutes(date.getMinutes() + minutes);
  return toLocalInput(date);
}
