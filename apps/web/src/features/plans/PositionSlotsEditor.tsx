import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';

export interface SlotItem {
  positionId: string;
  requiredCount: number;
}

interface TeamWithPositions {
  id: string;
  name: string;
  color: string;
  positions: { id: string; name: string }[];
}

// Editor für „welche Positionen werden hier gebraucht und wie viele?".
// Identische Struktur bei Termin-Slots (PUT /events/:id/slots) und
// Positions-Vorlagen eines Gottesdienst-Typs (PUT /service-types/:id/template),
// deshalb eine Komponente für beides.
export default function PositionSlotsEditor({
  value,
  onChange,
}: {
  value: SlotItem[];
  onChange: (items: SlotItem[]) => void;
}) {
  const { t } = useTranslation();
  const [teams, setTeams] = useState<TeamWithPositions[]>([]);
  const [addPositionId, setAddPositionId] = useState('');

  useEffect(() => {
    void api.get<TeamWithPositions[]>('/teams').then(setTeams).catch(console.error);
  }, []);

  const positionById = new Map(
    teams.flatMap((team) => team.positions.map((p) => [p.id, { ...p, team }] as const)),
  );
  const used = new Set(value.map((item) => item.positionId));

  function add() {
    if (!addPositionId || used.has(addPositionId)) return;
    onChange([...value, { positionId: addPositionId, requiredCount: 1 }]);
    setAddPositionId('');
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {value.map((item) => {
          const position = positionById.get(item.positionId);
          return (
            <li key={item.positionId} className="flex flex-wrap items-center gap-2 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: position?.team.color ?? 'transparent' }}
              />
              <span className="min-w-0 truncate">
                {position ? `${position.team.name} · ${position.name}` : item.positionId}
              </span>
              <label className="ml-auto flex items-center gap-1.5">
                <span className="text-xs text-faint">{t('slots.requiredCount')}</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={item.requiredCount}
                  onChange={(e) =>
                    onChange(
                      value.map((entry) =>
                        entry.positionId === item.positionId
                          ? { ...entry, requiredCount: Math.max(1, Number(e.target.value) || 1) }
                          : entry,
                      ),
                    )
                  }
                  className="input w-16 px-2 py-1 text-xs"
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  onChange(value.filter((entry) => entry.positionId !== item.positionId))
                }
                className="text-xs text-faint hover:text-paper"
              >
                {t('common.delete')}
              </button>
            </li>
          );
        })}
        {value.length === 0 && <li className="text-sm text-faint">{t('slots.empty')}</li>}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={addPositionId}
          onChange={(e) => setAddPositionId(e.target.value)}
          aria-label={t('slots.addPosition')}
          className="input w-auto max-w-full min-w-0 px-2 py-1 text-xs"
        >
          <option value="">{t('slots.selectPosition')}</option>
          {teams.map((team) => {
            const available = team.positions.filter((position) => !used.has(position.id));
            if (available.length === 0) return null;
            return (
              <optgroup key={team.id} label={team.name}>
                {available.map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.name}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <button
          type="button"
          onClick={add}
          disabled={!addPositionId}
          className="btn-ghost px-2 py-1 text-xs disabled:opacity-50"
        >
          + {t('slots.addPosition')}
        </button>
      </div>
    </div>
  );
}
