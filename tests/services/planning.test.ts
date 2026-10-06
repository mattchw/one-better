import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { planService, type PlanRepository, type PlanTransaction } from "../../src/modules/planning/service";
import { planningView, type OwnedPlan } from "../../src/modules/planning/domain";
import { now, plan, source } from "../planning-fixtures";
const actor = { userId: "owner" }; const create = () => ({ mutationId: randomUUID(), weekStartDate: plan.weekStartDate, provisionalCapacityMinutes: 720, reserveMinutes: 180 }); const transition = () => ({ mutationId: randomUUID(), expectedVersion: 2 });
const save = () => ({ ...transition(), provisionalCapacityMinutes: 720, reserveMinutes: 180, commitments: plan.commitments.map(({ actionId, source, budgetMinutes }) => ({ actionId, source, budgetMinutes })) });
function setup(value: OwnedPlan | null = plan, live = [source]) {
  const order: string[] = [];
  const tx: PlanTransaction = { firstTaskSource: vi.fn(async (title, minutes) => ({...source,context:{...source.context,action:{...source.context.action,title,estimateMinutes:minutes},goal:null}})), timezone: vi.fn(async () => "Europe/London"), findForUpdate: vi.fn(async () => { order.push("plan"); return value; }), lockSources: vi.fn(async () => { order.push("sources"); return live; }), insert: vi.fn(async (v) => ({ ...v, ownerId: actor.userId })), replace: vi.fn(async (v) => ({ ...v, ownerId: actor.userId })) };
  const repository: PlanRepository = { workspace: vi.fn(async () => ({ weekStartDate: plan.weekStartDate, currentWeekStartDate: plan.weekStartDate, timezone: plan.timezone, canCreate: true, view: planningView(plan, live), savedWeeks: [] })), read: vi.fn(async () => ({ plan: value, sources: live })), candidates: vi.fn(async () => live), executeOwned: vi.fn(async (_a, _id, _hash, apply) => apply(tx)) };
  return { tx, repository, order, service: planService(repository, () => now) };
}
it("validates commands before receipt/persistence and creates only current/future weeks in actor timezone", async () => {
  const { service, tx, repository } = setup(); await expect(service.create(actor, { ...create(), ownerId: "other" })).rejects.toMatchObject({ code: "VALIDATION" }); expect(repository.executeOwned).not.toHaveBeenCalled();
  await expect(service.create(actor, { ...create(), weekStartDate: "2026-09-21" })).rejects.toMatchObject({ code: "VALIDATION" }); expect(tx.insert).not.toHaveBeenCalled();
  for (const weekStartDate of ["2026-09-28", "2026-10-05"]) expect(await service.create(actor, { ...create(), weekStartDate })).toMatchObject({ weekStartDate, timezone: "Europe/London", state: "draft", commitments: [], version: 1 });
});
it("full Draft saves lock aggregate before sources and preserve identity/creation while changing budgets", async () => {
  const { service, tx, order } = setup(); const result = await service.save(actor, plan.id, { ...save(), commitments: [{ ...save().commitments[0], budgetMinutes: 600 }] });
  expect(order).toEqual(["plan", "sources"]); expect(result).toMatchObject({ version: 3, state: "draft", commitments: [{ id: plan.commitments[0].id, createdAt: plan.commitments[0].createdAt, budgetMinutes: 600, snapshot: null }] }); expect(tx.replace).toHaveBeenCalledWith(result, 2);
});
it("commit freezes snapshot copies and increments Plan once without writing sources", async () => {
  const { service, tx, order } = setup(); const result = await service.commit(actor, plan.id, transition()); expect(order).toEqual(["plan", "sources"]); expect(result).toMatchObject({ state: "committed", version: 3, committedAt: now, commitments: [{ budgetMinutes: 180, snapshot: source.context }] }); expect(result.commitments[0].snapshot).not.toBe(source.context); expect(tx.replace).toHaveBeenCalledTimes(1);
});
it.each(["EMPTY", "OVER_CAPACITY"])("%s blocks commit with no replacement", async (kind) => {
  const value = { ...plan, commitments: kind === "EMPTY" ? [] : [{ ...plan.commitments[0], budgetMinutes: 600 }] }; const { service, tx } = setup(value);
  await expect(service.commit(actor, plan.id, transition())).rejects.toMatchObject({ code: "VALIDATION", details: { kind } }); expect(tx.replace).not.toHaveBeenCalled();
});
it("changed, terminal and unavailable selections identify Action and never silently rewrite/remove", async () => {
  for (const live of [[{ ...source, source: { ...source.source, actionVersion: 2 } }], [{ ...source, eligible: false, reason: "Completed" }], []]) {
    const { service, tx } = setup(plan, live); for (const call of [service.save(actor, plan.id, save()), service.commit(actor, plan.id, transition())]) await expect(call).rejects.toMatchObject({ code: live.length ? "CONFLICT" : "NOT_FOUND", details: { issues: [expect.objectContaining({ actionId: source.actionId })] } }); expect(tx.replace).not.toHaveBeenCalled();
  }
});
it("stale/terminal versions and foreign/missing Plans never reach sources or replacement", async () => {
  for (const value of [null, { ...plan, ownerId: "foreign" }, { ...plan, version: 3 }, { ...plan, state: "committed" as const }]) {
    const { service, tx } = setup(value); for (const call of [service.save(actor, plan.id, save()), service.commit(actor, plan.id, transition())]) await expect(call).rejects.toMatchObject({ code: value && value.ownerId === actor.userId ? "CONFLICT" : "NOT_FOUND" }); expect(tx.lockSources).not.toHaveBeenCalled(); expect(tx.replace).not.toHaveBeenCalled();
  }
});
it("receipt replay precedes all current state/source/date checks for create/save/commit", async () => {
  const { service, repository, tx } = setup(null, []); vi.mocked(repository.executeOwned).mockResolvedValue(plan);
  expect(await service.create(actor, { ...create(), weekStartDate: "2026-09-21" })).toEqual(plan); expect(await service.save(actor, plan.id, save())).toEqual(plan); expect(await service.commit(actor, plan.id, transition())).toEqual(plan); expect(tx.timezone).not.toHaveBeenCalled(); expect(tx.findForUpdate).not.toHaveBeenCalled();
});
it("normalized selection order is logically equivalent while namespaces, budgets and versions bind hashes", async () => {
  const { service, repository } = setup(); const other = { ...source, actionId: randomUUID() }; const input = { ...save(), commitments: [...save().commitments, { actionId: other.actionId, source: other.source, budgetMinutes: 60 }] }; vi.mocked(repository.executeOwned).mockResolvedValue(plan);
  await service.save(actor, plan.id, input); await service.save(actor, plan.id, { ...input, commitments: [...input.commitments].reverse() }); expect(vi.mocked(repository.executeOwned).mock.calls[0][2]).toBe(vi.mocked(repository.executeOwned).mock.calls[1][2]);
  await service.create(actor, { ...create(), mutationId: input.mutationId }); await service.commit(actor, plan.id, { mutationId: input.mutationId, expectedVersion: 2 }); await service.save(actor, plan.id, { ...input, reserveMinutes: 120 }); await service.save(actor, plan.id, { ...input, expectedVersion: 3 }); expect(new Set(vi.mocked(repository.executeOwned).mock.calls.map((c) => c[2])).size).toBe(5);
});
it("candidates use effective eligibility and Plan reads scope owner", async () => {
  const { service, repository } = setup(plan, [source, { ...source, eligible: false }]); expect(await service.candidates(actor)).toEqual([source]); expect((await service.get(actor, plan.id)).plan).not.toHaveProperty("ownerId"); expect(repository.read).toHaveBeenCalledWith(actor, plan.id);
});
it('quick commitment freezes reviewed choices in one receipt transaction and preserves draft identities', async () => {
 const input = {...create(), planId:plan.id, expectedVersion:plan.version, commitments:save().commitments};
 const {service,tx,order}=setup(); const committed=await service.quickCommit(actor,input);
 expect(committed).toMatchObject({id:plan.id,state:'committed',version:3,commitments:[{id:plan.commitments[0].id,snapshot:source.context}]});
 expect(order).toEqual(['plan','sources']);expect(tx.insert).not.toHaveBeenCalled();expect(tx.replace).toHaveBeenCalledTimes(1);
 const fresh=setup(null);const created=await fresh.service.quickCommit(actor,{...create(),commitments:save().commitments});
 expect(created).toMatchObject({state:'committed',version:2});expect(fresh.tx.insert).toHaveBeenCalledTimes(1);expect(fresh.tx.replace).toHaveBeenCalledTimes(1);
});
it('quick commitment rejects foreign, stale, terminal and mismatched drafts before source writes',async()=>{
 for(const value of [null,{...plan,ownerId:'foreign'},{...plan,version:4},{...plan,state:'committed' as const},{...plan,weekStartDate:'2026-10-05'}]){
  const {service,tx}=setup(value);
  await expect(service.quickCommit(actor,{...create(),planId:plan.id,expectedVersion:plan.version,commitments:save().commitments})).rejects.toMatchObject({code:value&&value.ownerId===actor.userId?'CONFLICT':'NOT_FOUND'});
  expect(tx.lockSources).not.toHaveBeenCalled();expect(tx.replace).not.toHaveBeenCalled();
 }
});
it('quick commitment leaves no draft behind for invalid sources or capacity and validates the fifty-task boundary',async()=>{
 for(const live of [[],[{...source,eligible:false}],[{...source,source:{...source.source,actionVersion:99}}]]){
  const {service,tx}=setup(null,live);await expect(service.quickCommit(actor,{...create(),commitments:save().commitments})).rejects.toMatchObject({code:live.length?'CONFLICT':'NOT_FOUND'});expect(tx.insert).not.toHaveBeenCalled();
 }
 const {service,tx}=setup(null);
 for(const commitments of [[],Array.from({length:51},()=>({...save().commitments[0],actionId:randomUUID()})),[{...save().commitments[0],budgetMinutes:600}]])await expect(service.quickCommit(actor,{...create(),commitments})).rejects.toMatchObject({code:'VALIDATION'});
 await expect(service.quickCommit(actor,{...create(),planId:plan.id,commitments:save().commitments})).rejects.toMatchObject({code:'VALIDATION'});expect(tx.insert).not.toHaveBeenCalled();
});
it('quick receipt replay precedes changing eligibility and time',async()=>{
 const {service,repository,tx}=setup(null,[]);vi.mocked(repository.executeOwned).mockResolvedValue(plan);
 expect(await service.quickCommit(actor,{...create(),weekStartDate:'2026-09-21',commitments:save().commitments})).toEqual(plan);expect(tx.lockSources).not.toHaveBeenCalled();
});
it('first task freezes one reviewed task with a visible source and a small reserved first baseline',async()=>{
 const {service,tx}=setup(null);const result=await service.firstTask(actor,{mutationId:randomUUID(),weekStartDate:plan.weekStartDate,title:'  Draft the project proposal  ',budgetMinutes:60});
 expect(result).toMatchObject({state:'committed',version:2,provisionalCapacityMinutes:80,reserveMinutes:20,commitments:[{budgetMinutes:60,snapshot:{action:{title:'Draft the project proposal',estimateMinutes:60},goal:null}}]});
 expect(tx.firstTaskSource).toHaveBeenCalledWith('Draft the project proposal',60,now,undefined);expect(tx.replace).toHaveBeenCalledTimes(1);
});
it('first task strictly bounds the duration and title before any transaction',async()=>{
 const {service,repository}=setup(null);
 for(const fields of [{title:'',budgetMinutes:60},{title:'x'.repeat(161),budgetMinutes:60},{title:'Task',budgetMinutes:90},{title:'Task',budgetMinutes:60,ownerId:'foreign'}])await expect(service.firstTask(actor,{mutationId:randomUUID(),weekStartDate:plan.weekStartDate,...fields})).rejects.toMatchObject({code:'VALIDATION'});
 expect(repository.executeOwned).not.toHaveBeenCalled();
});
it('first task preserves sufficient empty-draft capacity, expands insufficient capacity and rejects nonempty drafts',async()=>{
 const input={mutationId:randomUUID(),weekStartDate:plan.weekStartDate,planId:plan.id,expectedVersion:plan.version,title:'First task',budgetMinutes:120};
 const empty={...plan,commitments:[]};expect(await setup(empty).service.firstTask(actor,input)).toMatchObject({id:plan.id,provisionalCapacityMinutes:720,reserveMinutes:180,version:3});
 const nonempty=setup(plan);await expect(nonempty.service.firstTask(actor,input)).rejects.toMatchObject({code:'CONFLICT'});expect(nonempty.tx.replace).not.toHaveBeenCalled();
 const tiny=setup({...empty,provisionalCapacityMinutes:60,reserveMinutes:30});expect(await tiny.service.firstTask(actor,input)).toMatchObject({id:plan.id,state:'committed',provisionalCapacityMinutes:160,reserveMinutes:40,version:3,commitments:[{budgetMinutes:120}]});expect(tiny.tx.insert).not.toHaveBeenCalled();expect(tiny.tx.replace).toHaveBeenCalledTimes(1);
 const reserved=setup({...empty,provisionalCapacityMinutes:180,reserveMinutes:120});expect(await reserved.service.firstTask(actor,input)).toMatchObject({provisionalCapacityMinutes:240,reserveMinutes:120});
 const maximum=setup({...empty,provisionalCapacityMinutes:10080,reserveMinutes:10079});expect(await maximum.service.firstTask(actor,input)).toMatchObject({provisionalCapacityMinutes:10080,reserveMinutes:9960});
});
it('first-task receipt replay precedes setup and date checks',async()=>{
 const {service,repository,tx}=setup(null);vi.mocked(repository.executeOwned).mockResolvedValue(plan);
 expect(await service.firstTask(actor,{mutationId:randomUUID(),weekStartDate:'2026-09-21',title:'First task',budgetMinutes:30})).toEqual(plan);expect(tx.firstTaskSource).not.toHaveBeenCalled();
});
