import { Injectable, NotFoundException } from '@nestjs/common';
import { EvalRunStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SearchService } from '../search/search.service';
import { AuditService } from '../audit/audit.service';

const DEFAULT_CASES = [
  {
    query: 'remote work policy',
    expectAny: ['remote', 'work from home', 'wfh'],
  },
  {
    query: 'vacation leave days',
    expectAny: ['leave', 'vacation', 'pto', 'ngày nghỉ'],
  },
  {
    query: 'password reset',
    expectAny: ['password', 'reset', 'mật khẩu'],
  },
];

@Injectable()
export class EvalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
    private readonly audit: AuditService,
  ) {}

  list(orgId: string) {
    return this.prisma.evalRun.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }

  async run(
    orgId: string,
    kbId: string | undefined,
    actorUserId: string,
  ) {
    const kb =
      kbId ||
      (
        await this.prisma.knowledgeBase.findFirst({
          where: { organizationId: orgId, deletedAt: null, status: 'active' },
          orderBy: { createdAt: 'asc' },
        })
      )?.id;

    if (!kb) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'No knowledge base to evaluate',
      });
    }

    const run = await this.prisma.evalRun.create({
      data: {
        organizationId: orgId,
        knowledgeBaseId: kb,
        status: EvalRunStatus.running,
      },
    });

    try {
      const caseResults: Array<{
        query: string;
        hit: boolean;
        topScore: number;
        topTitle?: string | null;
      }> = [];

      for (const c of DEFAULT_CASES) {
        const { results } = await this.search.hybridSearch({
          organizationId: orgId,
          knowledgeBaseId: kb,
          query: c.query,
          topK: 5,
          skipRerank: true,
        });
        const blob = results
          .map((r) => `${r.title || ''} ${r.content}`.toLowerCase())
          .join('\n');
        const hit = c.expectAny.some((term) => blob.includes(term.toLowerCase()));
        caseResults.push({
          query: c.query,
          hit,
          topScore: results[0]?.score ?? 0,
          topTitle: results[0]?.title,
        });
      }

      const score =
        caseResults.filter((c) => c.hit).length / Math.max(caseResults.length, 1);

      const finished = await this.prisma.evalRun.update({
        where: { id: run.id },
        data: {
          status: EvalRunStatus.succeeded,
          score,
          stats: { cases: caseResults, knowledgeBaseId: kb },
          finishedAt: new Date(),
        },
      });

      await this.audit.log({
        organizationId: orgId,
        actorUserId,
        action: 'eval.run',
        resourceType: 'eval_run',
        resourceId: run.id,
        metadata: { score },
      });

      return finished;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.prisma.evalRun.update({
        where: { id: run.id },
        data: {
          status: EvalRunStatus.failed,
          error: message,
          finishedAt: new Date(),
        },
      });
    }
  }
}
