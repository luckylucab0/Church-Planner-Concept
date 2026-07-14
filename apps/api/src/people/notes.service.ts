import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { NoteKind } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { PermissionsService } from '../authz/permissions.service';
import { decryptField, encryptField } from '../common/crypto/field-crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface NoteView {
  id: string;
  kind: NoteKind;
  content: string;
  authorName: string | null;
  createdAt: Date;
}

// Notizen über Personen: at rest AES-verschlüsselt, mit eigener
// Berechtigungsstufe pro Art:
// - GENERAL:  Admin + Teamleiter der betroffenen Person
// - PASTORAL: nur Admin (seelsorgerlich – höchste Schutzstufe)
@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  private async canAccess(user: AuthUser, personId: string, kind: NoteKind): Promise<boolean> {
    if (this.permissions.isAdmin(user)) return true;
    if (kind === 'PASTORAL') return false;
    const relationship = await this.permissions.relationshipTo(user, personId);
    return relationship.canNotesOnTarget;
  }

  async listFor(user: AuthUser, personId: string): Promise<NoteView[]> {
    const canGeneral = await this.canAccess(user, personId, 'GENERAL');
    const canPastoral = await this.canAccess(user, personId, 'PASTORAL');
    if (!canGeneral && !canPastoral) throw new ForbiddenException();

    const kinds: NoteKind[] = [
      ...(canGeneral ? (['GENERAL'] as const) : []),
      ...(canPastoral ? (['PASTORAL'] as const) : []),
    ];
    const notes = await this.prisma.note.findMany({
      where: { personId, kind: { in: kinds } },
      include: { author: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });

    this.audit.log({
      actorId: user.personId,
      action: 'VIEW',
      entityType: 'Note',
      entityId: personId,
    });

    return notes.map((note) => ({
      id: note.id,
      kind: note.kind,
      content: decryptField(note.contentEncrypted),
      authorName: note.author ? `${note.author.firstName} ${note.author.lastName}` : null,
      createdAt: note.createdAt,
    }));
  }

  async create(
    user: AuthUser,
    personId: string,
    kind: NoteKind,
    content: string,
  ): Promise<NoteView> {
    if (!(await this.canAccess(user, personId, kind))) throw new ForbiddenException();
    const target = await this.prisma.person.findUnique({
      where: { id: personId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException();

    const note = await this.prisma.note.create({
      data: {
        personId,
        kind,
        contentEncrypted: encryptField(content),
        authorId: user.personId,
      },
      include: { author: { select: { firstName: true, lastName: true } } },
    });
    this.audit.log({
      actorId: user.personId,
      action: 'CREATE',
      entityType: 'Note',
      entityId: note.id,
    });
    return {
      id: note.id,
      kind: note.kind,
      content,
      authorName: note.author ? `${note.author.firstName} ${note.author.lastName}` : null,
      createdAt: note.createdAt,
    };
  }

  async delete(user: AuthUser, noteId: string): Promise<void> {
    const note = await this.prisma.note.findUnique({ where: { id: noteId } });
    if (!note) throw new NotFoundException();
    if (!(await this.canAccess(user, note.personId, note.kind))) throw new ForbiddenException();
    await this.prisma.note.delete({ where: { id: noteId } });
    this.audit.log({
      actorId: user.personId,
      action: 'DELETE',
      entityType: 'Note',
      entityId: noteId,
    });
  }
}
