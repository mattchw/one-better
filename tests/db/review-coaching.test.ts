import {beforeAll,afterAll,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {connectDatabase} from '../../src/db/connect';
import {requireTestDatabaseURL} from '../../scripts/test-database';
import {seedR5F} from '../r5f-scenario';
import {reviewPrivacyMarkers} from '../review-insight-fixture';
import {coachingOutput} from '../coaching-fixture';
import {coachingCleanupTables} from '../coaching-database';
import {coachingService} from '../../src/modules/coaching/service';
import {coachingRepository} from '../../src/modules/coaching/repository';
const database=connectDatabase(requireTestDatabaseURL().url);let scenario:Awaited<ReturnType<typeof seedR5F>>;
beforeAll(async()=>{await migrate(database.db,{migrationsFolder:'src/db/migrations'});scenario=await seedR5F(database.db,database.pool);});
afterAll(async()=>{if(scenario){const owners=scenario.fixtures.map(f=>f.actor.userId);for(const t of coachingCleanupTables)await database.pool.query(`DELETE FROM ${t} WHERE owner_id=ANY($1)`,[owners]);await database.pool.query('DELETE FROM app_user WHERE id=ANY($1)',[owners]);}await database.pool.end();});
it('real owned readers build all six relationships and exclude drafts/late/session/provider content',async()=>{
 for(const f of scenario.fixtures){const context=await scenario.services.context(f.actor,f.scope),text=JSON.stringify(context);for(const marker of [reviewPrivacyMarkers.draftDaily,reviewPrivacyMarkers.draftWeekly,reviewPrivacyMarkers.late,reviewPrivacyMarkers.session,reviewPrivacyMarkers.google])expect(text).not.toContain(marker);
  if(['clean','already_addressed','completed'].includes(f.kind))expect(context.reviewCandidates).toEqual([]);else expect(context.reviewCandidates?.length).toBeGreaterThan(0);
  if(f.kind==='repeated_carry')expect(context.reviewCandidates?.[0].type).toBe('repeated_carry');if(f.kind==='gap_reflection')expect(context.reviewCandidates?.[0].reflectionRefs.length).toBeGreaterThan(0);
 }
});
it('Review generation is owner-scoped and changes no upstream tables',async()=>{
 const f=scenario.fixtures[0],other=scenario.fixtures[1],before:Record<string,unknown>={};for(const t of coachingCleanupTables.filter(t=>t!=='ai_recommendation_run'))before[t]=(await database.pool.query(`SELECT row_to_json(t) FROM ${t} t WHERE owner_id=$1 ORDER BY row_to_json(t)::text`,[f.actor.userId])).rows;
 const provider={name:'openai' as const,model:'fixture',generateCoaching:vi.fn(async(context:Parameters<typeof coachingOutput>[0])=>({output:coachingOutput(context),usage:{inputTokens:100,outputTokens:50,cachedInputTokens:0}}))};
 const service=coachingService({repository:coachingRepository(database.db),context:scenario.services.context,provider,configuration:'ready',scheduling:scenario.services.schedule,clock:scenario.clock});const view=await service.view(f.actor,f.scope),run=await service.generate(f.actor,{...f.scope,mutationId:randomUUID(),fingerprint:view.fingerprint});expect(run.status).toBe('succeeded');expect((await service.view(other.actor,f.scope)).run).toBeNull();
 for(const t of Object.keys(before))expect((await database.pool.query(`SELECT row_to_json(t) FROM ${t} t WHERE owner_id=$1 ORDER BY row_to_json(t)::text`,[f.actor.userId])).rows).toEqual(before[t]);
 const source=(await scenario.services.plans.candidates(f.actor))[0];const next=await scenario.services.plans.create(f.actor,{mutationId:randomUUID(),weekStartDate:'2028-01-10',provisionalCapacityMinutes:180,reserveMinutes:30});await scenario.services.plans.save(f.actor,next.id,{mutationId:randomUUID(),expectedVersion:next.version,provisionalCapacityMinutes:180,reserveMinutes:30,commitments:[{actionId:source.actionId,budgetMinutes:90,source:source.source}]});
 expect((await service.view(f.actor,f.scope)).run?.stale).toBe(true);const context=await scenario.services.context(f.actor,f.scope);expect(context.reviewCandidates?.[0].following).toMatchObject({state:'draft',budgetMinutes:90,scheduledMinutes:0,carryIntentMinutes:90});
});
