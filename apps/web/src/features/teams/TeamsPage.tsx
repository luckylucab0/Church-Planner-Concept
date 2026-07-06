import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';

interface TeamSummary {
  id: string;
  name: string;
  color: string;
  memberCount: number;
  positions: { id: string; name: string }[];
  canManage: boolean;
}

interface TeamDetail {
  id: string;
  name: string;
  canManage: boolean;
  members: {
    id: string;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    isLeader: boolean;
  }[];
  positions: {
    id: string;
    name: string;
    people: { personId: string; name: string; skillLevel: string }[];
  }[];
}

// Teams-Übersicht mit aufklappbarem Detail. Die API liefert nur, was die
// Rolle sehen darf (canManage steuert lediglich, welche Aktionen die UI
// anbietet – durchgesetzt wird serverseitig).
export default function TeamsPage() {
  const { t } = useTranslation();
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [openTeam, setOpenTeam] = useState<TeamDetail | null>(null);

  useEffect(() => {
    void api.get<TeamSummary[]>('/teams').then(setTeams);
  }, []);

  const openDetail = useCallback((teamId: string) => {
    void api.get<TeamDetail>(`/teams/${teamId}`).then(setOpenTeam);
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-[26px] font-bold tracking-tight text-paper">{t('nav.teams')}</h1>

      <div className="grid gap-3 sm:grid-cols-2">
        {teams.map((team) => (
          <button key={team.id} onClick={() => openDetail(team.id)} className="card p-4 text-left">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: team.color }} />
              <span className="font-semibold text-paper">{team.name}</span>
              <span className="ml-auto text-sm text-muted">{team.memberCount} 👤</span>
            </div>
            <p className="mt-1 text-sm text-muted">
              {team.positions.map((p) => p.name).join(' · ') || '—'}
            </p>
          </button>
        ))}
      </div>

      {openTeam && (
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-paper">{openTeam.name}</h2>
            <button onClick={() => setOpenTeam(null)} className="text-sm text-faint">
              ✕
            </button>
          </div>

          <h3 className="mt-3 text-sm font-medium text-secondary">{t('teams.members')}</h3>
          <ul className="mt-1 divide-y divide-line">
            {openTeam.members.map((member) => (
              <li key={member.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span>
                  {member.firstName} {member.lastName}
                  {member.isLeader && (
                    <span className="ml-1 badge badge-gold">{t('teams.leader')}</span>
                  )}
                </span>
                {(member.email || member.phone) && (
                  <span className="ml-auto truncate text-muted">
                    {[member.email, member.phone].filter(Boolean).join(' · ')}
                  </span>
                )}
              </li>
            ))}
          </ul>

          <h3 className="mt-3 text-sm font-medium text-secondary">{t('teams.positions')}</h3>
          <ul className="mt-1 space-y-1">
            {openTeam.positions.map((position) => (
              <li key={position.id} className="text-sm">
                <span className="font-medium">{position.name}:</span>{' '}
                <span className="text-muted">
                  {position.people.map((p) => p.name).join(', ') || '—'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
