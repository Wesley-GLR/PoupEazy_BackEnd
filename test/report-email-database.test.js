require('../test-support/safe-env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const explicit = process.env.TEST_DATABASE_URL;
const source = new URL(explicit || 'postgres://report_test:report_test@127.0.0.1:1/poupeazy_report_test');
if (!['localhost', '127.0.0.1'].includes(source.hostname) || source.pathname !== '/poupeazy_report_test') throw new Error('Use apenas PostgreSQL local descartavel.');
const databaseName = `poupeazy_report_test_reports_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
const isolated = new URL(source); isolated.pathname = `/${databaseName}`;
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: isolated.toString(), DATABASE_SSL: 'disable', JWT_SECRET: 'modular-report-tests-only-not-production' });
const db = require('../src/db');
const { createApp } = require('../src/app');
const { gerarToken } = require('../src/middleware/auth');
const { normalizeReportRequest, collectReportSnapshot } = require('../src/services/report-data.service');
const { createReportEmailService } = require('../src/services/report-email.service');
const { renderReportAttachments } = require('../src/services/report-renderer');
const { deleteAccount } = require('../src/services/account-deletion.service');

describe('Relatorios modulares + PostgreSQL real descartavel', { skip: !explicit }, () => {
  let admin, server, base, user, other, goalId, food, transport, salary, goalsCategory; let created = false;
  const password = 'SyntheticModularReportPassword123!'; const hash = bcrypt.hashSync(password, 4);
  const migration = fs.readFileSync(path.join(__dirname, '../db/migrations/009_report_email.sql'), 'utf8');
  const sent = [];
  const body = (secoes = ['resumo','transacoes','categorias','orcamentos','metas'], formatos = ['pdf','csv']) => ({ data_inicio:'2026-10-10', data_fim:'2026-11-05', secoes, formatos });
  async function account(verified = true) {
    const { rows: [row] } = await db.query(`INSERT INTO usuarios (email,senha_hash,email_verificacao_obrigatoria,email_verificado_em)
      VALUES ($1,$2,FALSE,CASE WHEN $3 THEN NOW() ELSE NULL END) RETURNING *`, [`reports.${crypto.randomUUID()}@example.test`,hash,verified]);
    await db.query("INSERT INTO profiles (id,nome) VALUES ($1,'Pessoa sintetica')",[row.id]);
    return row;
  }
  async function budget(owner, mes, planned = 1000) {
    return (await db.query('INSERT INTO orcamento (id_usuario,ano,mes,valor_planejado) VALUES ($1,2026,$2,$3) RETURNING *',[owner.id,mes,planned])).rows[0];
  }
  async function tx(month, value, date, { tipo='despesa',category=food,status='confirmada',goal=null,description='Compra sintetica' } = {}) {
    return (await db.query(`INSERT INTO despesas (id_orcamento,id_categoria,id_metas,valor,data_transacao,descricao,tipo,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[month.id,category,goal,value,date,description,tipo,status])).rows[0];
  }
  const collect = (owner, request = body(), database = db) => collectReportSnapshot({ database, userId:owner.id, request:normalizeReportRequest(request) });
  const mailService = (sendEmail, renderAttachments) => createReportEmailService({ database:db,emailEnabled:true,sendEmail,renderAttachments });
  const fakeRender = async () => [{filename:'poupeazy-resumo-2026-10-10-2026-11-05.csv',content:Buffer.from('\ufeffSintetico\r\n'),contentType:'text/csv'}];
  async function request(owner, payload = body(['resumo'],['csv'])) {
    const response = await fetch(`${base}/api/relatorios/email`,{method:'POST',headers:{'Content-Type':'application/json',...(owner?{Authorization:`Bearer ${gerarToken(owner)}`}:{})},body:JSON.stringify(payload)});
    return {status:response.status,body:await response.json()};
  }
  before(async () => {
    admin = new Pool({connectionString:source.toString(),ssl:false});
    assert.match(databaseName,/^poupeazy_report_test_reports_\d+_[0-9a-f]{8}$/);
    await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
    await db.query(fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8'));
    await db.query(migration); await db.query(migration);
    user=await account(); other=await account();
    const cats=(await db.query('SELECT id,nome,tipo FROM categoria WHERE sistema=TRUE')).rows;
    food=cats.find(c=>c.nome==='Alimentação').id; transport=cats.find(c=>c.nome==='Transporte').id; salary=cats.find(c=>c.nome==='Salário').id;
    goalsCategory=(await db.query("INSERT INTO categoria (id_usuario,nome,tipo) VALUES ($1,'Metas sinteticas','despesa_variavel') RETURNING id",[user.id])).rows[0].id;
    goalId=(await db.query("INSERT INTO metas (id_usuario,nome,valor_objetivo,data_limite) VALUES ($1,'Poupanca sintetica',1000,'2027-12-31') RETURNING id",[user.id])).rows[0].id;
    const september=await budget(user,9), october=await budget(user,10), november=await budget(user,11,500);
    await tx(september,250,'2026-09-30',{goal:goalId,category:goalsCategory});
    await tx(october,1000,'2026-10-10',{tipo:'receita',category:salary});
    await tx(october,10.10,'2026-10-12',{description:'=HYPERLINK("https://example.test";"texto")'});
    await tx(october,.20,'2026-10-13',{description:'Mercado; "promocao"\nLinha2'});
    await tx(october,100,'2026-10-15',{goal:goalId,category:goalsCategory});
    await tx(october,20,'2026-10-15',{goal:goalId,tipo:'receita',category:salary});
    await tx(october,200,'2026-10-31',{category:transport});
    await tx(november,.30,'2026-11-05'); await tx(november,500,'2026-11-05',{tipo:'receita',category:salary});
    await tx(october,30,'2026-10-09'); await tx(november,40,'2026-11-06');
    await tx(november,70,'2026-11-06',{goal:goalId,category:goalsCategory});
    await tx(october,99.99,'2026-10-20',{status:'pendente'}); await tx(october,77.77,'2026-10-21',{status:'cancelada'});
    await tx(await budget(other,10),999999.99,'2026-10-15',{description:'SEGREDO OUTRA CONTA'});
    server=createApp({sendEmail:async message=>{sent.push(message);return{id:'synthetic-accepted'};}}).listen(0,'127.0.0.1');
    await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});base=`http://127.0.0.1:${server.address().port}`;
  });
  after(async()=>{
    if(server)await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
    await db.pool.end(); if(created)await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`); if(admin)await admin.end();
  });

  test('REPORT-DB-01 periodo confirmado e centavos corretos, sem dados da outra conta',async()=>{
    const {report}=await collect(user);const d=report.dados;
    assert.equal(d.resumo.receitas,'1520.00');assert.equal(d.resumo.despesas,'310.60');assert.equal(d.resumo.saldo,'1209.40');assert.equal(d.resumo.transacoes,8);
    assert.equal(d.transacoes.length,8);assert.equal(d.categorias.find(c=>c.categoria==='Alimentação').total,'10.60');
    assert.equal(d.orcamentos.length,2);assert.equal(d.orcamentos[0].valor_planejado,'1000.00');assert.equal(d.orcamentos[0].gasto_periodo,'310.30');
    assert.equal(d.orcamentos[0].inicio_coberto,'2026-10-10');assert.equal(d.orcamentos[0].fim_coberto,'2026-10-31');assert.equal(d.orcamentos[0].mes_parcial,true);
    assert.equal(d.orcamentos[1].gasto_periodo,'0.30');assert.equal(d.orcamentos[1].mes_parcial,true);
    const goal=d.metas.find(m=>m.nome==='Poupanca sintetica');
    assert.equal(goal.valor_atual,'400.00');assert.equal(goal.aportes_periodo,'100.00');assert.equal(goal.retiradas_periodo,'20.00');assert.equal(goal.movimento_periodo,'80.00');
    assert.doesNotMatch(JSON.stringify(report),/SEGREDO OUTRA CONTA|999999\.99|senha_hash|reset_token|nlp_metadata|id_usuario/);
  });

  test('REPORT-DB-02 inclui somente modulos escolhidos e exporta buffers PDF/CSV',async()=>{
    const {report}=await collect(user,body(['resumo']));
    assert.deepEqual(Object.keys(report.dados),['resumo']);assert.deepEqual(report.secoes,['resumo']);
    const attachments=await renderReportAttachments(report,['pdf','csv']);assert.equal(attachments.length,2);
    assert.ok(attachments.every(item=>Buffer.isBuffer(item.content)));
    const pdf=attachments.find(item=>item.contentType==='application/pdf');assert.equal(pdf.content.subarray(0,4).toString(),'%PDF');
    const csv=attachments.find(item=>item.contentType.startsWith('text/csv'));assert.equal(csv.content.subarray(0,3).toString('hex'),'efbbbf');
    assert.doesNotMatch(csv.content.toString('utf8'),/HYPERLINK|Poupanca sintetica|SEGREDO OUTRA CONTA/);
  });

  test('REPORT-DB-03 CSV de transacoes neutraliza formula e mantem delimitadores/aspas como dados',async()=>{
    const {report}=await collect(user,body(['transacoes'],['csv']));const [csv]=await renderReportAttachments(report,['csv']);const text=csv.content.toString('utf8');
    assert.match(text,/'=HYPERLINK/);assert.match(text,/Mercado; ""promocao""/);assert.match(text,/Linha2/);assert.doesNotMatch(text,/SEGREDO OUTRA CONTA/);
  });

  test('REPORT-DB-04 snapshot repeatable read nao mistura gravacao ocorrida entre consultas',async()=>{
    const person=await account();const month=await budget(person,10);await tx(month,1,'2026-10-15');let inserted=false;
    const wrapped={getClient:async()=>{const client=await db.getClient();return{release:()=>client.release(),query:async(sql,args)=>{
      const result=await client.query(sql,args);
      if(!inserted&&/^SELECT id, email/.test(sql)){inserted=true;await tx(month,99,'2026-10-15');}
      return result;
    }};}};
    const {report}=await collect(person,body(['resumo']),wrapped);assert.equal(inserted,true);assert.equal(report.dados.resumo.despesas,'1.00');
    assert.equal((await db.query('SELECT SUM(valor)::text AS total FROM despesas WHERE id_orcamento=$1',[month.id])).rows[0].total,'100.00');
  });

  test('REPORT-DB-05 autenticacao, email confirmado, corpo sem destinatario e aceite real do fake Gmail',async()=>{
    const legacy=await account(false);assert.equal((await request()).status,401);
    const blocked=await request(legacy);assert.equal(blocked.status,403);assert.equal(blocked.body.code,'EMAIL_NOT_VERIFIED');
    const invalid=await request(user,{...body(['resumo'],['csv']),email:other.email});assert.equal(invalid.status,422);assert.equal(invalid.body.code,'REPORT_REQUEST_INVALID');
    const result=await request(user);assert.equal(result.status,200);assert.equal(result.body.retry_after_seconds,60);
    assert.equal(sent.length,1);assert.equal(sent[0].to,user.email);assert.equal(sent[0].attachments.length,1);
    assert.doesNotMatch(sent[0].text||'',/1520\.00|HYPERLINK|SEGREDO OUTRA CONTA/);
    const second=await request(user);assert.equal(second.status,429);assert.equal(second.body.code,'REPORT_COOLDOWN');
    await db.query(migration);assert.ok((await db.query('SELECT relatorio_email_solicitado_em FROM usuarios WHERE id=$1',[user.id])).rows[0].relatorio_email_solicitado_em);
  });

  test('REPORT-DB-06 envio concorrente por conta tem uma tentativa e resposta so apos aceite',async()=>{
    const person=await account();let accept,entered;
    const entry=new Promise(resolve=>{entered=resolve;});const held=new Promise(resolve=>{accept=resolve;});let attempts=0;
    const service=mailService(async()=>{attempts++;entered();await held;return{id:'fake'};},fakeRender);
    const first=service.sendReport(person.id,body(['resumo'],['csv']));first.catch(()=>{});await entry;
    try{
      await assert.rejects(service.sendReport(person.id,body(['resumo'],['csv'])),error=>error.status===429);
      const second=mailService(async()=>{attempts++;},fakeRender);
      await assert.rejects(second.sendReport(person.id,body(['resumo'],['csv'])),error=>error.status===429);
    }finally{accept();await first;}
    assert.equal(attempts,1);
  });

  test('REPORT-DB-07 resultado desconhecido preserva cooldown sem expor erro privado ou repetir',async t=>{
    const person=await account();const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args.join(' ')));let attempts=0;
    const service=mailService(async()=>{attempts++;throw new Error('private-oauth-token-not-for-logs');},fakeRender);
    await assert.rejects(service.sendReport(person.id,body(['resumo'],['csv'])),error=>error.status===502&&error.code==='EMAIL_SEND_UNKNOWN');
    await assert.rejects(service.sendReport(person.id,body(['resumo'],['csv'])),error=>error.status===429);
    assert.equal(attempts,1);assert.ok(logs.every(line=>!line.includes('private-oauth-token')));
  });

  test('REPORT-DB-08 fonte maior que limites e recusada integralmente sem cortar',async()=>{
    const person=await account();const month=await budget(person,10);
    await db.query(`INSERT INTO despesas (id_orcamento,id_categoria,valor,data_transacao,descricao,tipo)
      SELECT $1,$2,1,'2026-10-15','Registro sintetico','despesa' FROM generate_series(1,1001)`,[month.id,food]);
    await assert.rejects(collect(person,body(['resumo'])),error=>error.status===422&&error.code==='REPORT_LIMIT_EXCEEDED');
    const manyGoals=await account();await db.query(`INSERT INTO metas (id_usuario,nome,valor_objetivo,data_limite)
      SELECT $1,'Meta sintetica '||n,100,'2027-12-31' FROM generate_series(1,201) n`,[manyGoals.id]);
    await assert.rejects(collect(manyGoals,body(['metas'])),error=>error.status===422&&error.code==='REPORT_LIMIT_EXCEEDED');
    assert.deepEqual(Object.keys((await collect(manyGoals,body(['resumo']))).report.dados),['resumo']);
  });

  test('REPORT-DB-09 exclusao entre geracao e envio impede entrega a conta removida',async()=>{
    const person=await account();let attempts=0;
    const service=mailService(async()=>{attempts++;},async()=>{await deleteAccount({database:db,email:person.email,password});return fakeRender();});
    await assert.rejects(service.sendReport(person.id,body(['resumo'],['csv'])));assert.equal(attempts,0);
  });
});
