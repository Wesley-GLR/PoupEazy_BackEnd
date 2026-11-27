require('../test-support/safe-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReportRequest } = require('../src/services/report-data.service');
const { renderReportAttachments, csvCell } = require('../src/services/report-renderer');
const { createReportEmailService } = require('../src/services/report-email.service');
const { reportFixture } = require('../test-support/report-fixture');
const body={data_inicio:'2026-11-01',data_fim:'2026-11-27',secoes:['resumo'],formatos:['csv']};

test('REPORT-01 valida datas reais, faixa, selecoes distintas e campos extras',()=>{
  assert.deepEqual(normalizeReportRequest(body),body);
  for(const patch of [
    {data_inicio:'2026-02-30'},{data_inicio:'1999-12-31'},{data_fim:'2101-01-01'},
    {data_inicio:'2025-01-01',data_fim:'2026-01-02'},{data_fim:'2026-10-31'},
    {secoes:[]},{secoes:['resumo','resumo']},{secoes:['private']},{formatos:[]},{formatos:['csv','csv']},
    {formatos:['xlsx']},{email:'other@example.test'},{attachments:[]},
  ])assert.throws(()=>normalizeReportRequest({...body,...patch}),{code:'REPORT_REQUEST_INVALID'});
  assert.equal(normalizeReportRequest({...body,data_inicio:'2024-01-01',data_fim:'2024-12-31'}).data_fim,'2024-12-31');
});

test('REPORT-02 CSV neutraliza formulas sem quebrar Unicode, aspas ou separadores',()=>{
  for(const value of ['=SUM(1;2)',' +1','-1+2','\t@danger','\r\n=1','\uFEFF=1'])assert.match(csvCell(value),/^"'/);
  assert.equal(csvCell('Café; "família"'),'"Café; ""família"""');
  assert.equal(csvCell('漢字 🌍'),'"漢字 🌍"');
});

test('REPORT-03 cada CSV contem apenas a secao escolhida, com BOM e CRLF',async()=>{
  const report=reportFixture(2);
  const tokens={resumo:'5200,00',transacoes:'Compra com descrição',categorias:'Quantidade',orcamentos:'Planejado integral',metas:'Reserva de emergência'};
  for(const section of report.secoes){
    const [file]=await renderReportAttachments({...report,secoes:[section]},['csv']);
    assert.equal(file.contentType,'text/csv; charset=utf-8');
    assert.ok(file.content.subarray(0,3).equals(Buffer.from([239,187,191])));
    const text=file.content.toString('utf8');
    assert.match(text,/\r\n/);
    assert.ok(text.includes(tokens[section]));
    if(section!=='metas')assert.equal(text.includes(tokens.metas),false);
    if(section!=='transacoes')assert.equal(text.includes(tokens.transacoes),false);
    if(section!=='orcamentos')assert.equal(text.includes(tokens.orcamentos),false);
  }
});

test('REPORT-04 PDF usa Inter, pagina dados extensos e produz ate seis anexos em memoria',async()=>{
  const files=await renderReportAttachments(reportFixture(28),['pdf','csv']);
  assert.equal(files.length,6);
  assert.equal(files[0].content.subarray(0,5).toString(),'%PDF-');
  assert.ok(files.reduce((sum,file)=>sum+file.content.length,0)<5*1024*1024);
  assert.ok(files.every(file=>Buffer.isBuffer(file.content)));
  assert.match(files[5].content.toString('utf8'),/🌍 漢字/);
});

function fakeDatabase(){
  let verified=true;
  return {setVerified:value=>{verified=value;},query:async(sql)=>{
    if(sql.startsWith('UPDATE usuarios'))return {rows:[{id:'owner'}]};
    if(sql.startsWith('SELECT email,'))return {rows:[{email:'owner@example.test',email_verificado_em:verified?new Date():null}]};
    throw new Error('unexpected-query');
  },getClient:async()=>({release(){},query:async(sql)=>{
    if(sql.startsWith('BEGIN')||sql.startsWith('SET')||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
    if(sql.startsWith('SELECT id, email'))return {rows:[{id:'owner',email:'owner@example.test',email_verificado_em:new Date(),gerado_em:new Date()}]};
    if(sql.includes('COUNT(*)::int AS total'))return {rows:[{total:0}]};
    return {rows:[{receitas:'0',despesas:'0',saldo:'0',transacoes:0}]};
  }})};
}
const csvFiles=[{filename:'poupeazy-resumo-2026-11-01-2026-11-27.csv',content:Buffer.from('\uFEFFa\r\n'),contentType:'text/csv; charset=utf-8'}];

test('REPORT-05 processo limita concorrencia antes do claim e envia so ao e-mail do banco',async()=>{
  const database=fakeDatabase();let finish;const messages=[];
  const service=createReportEmailService({database,emailEnabled:true,renderAttachments:()=>new Promise(resolve=>{finish=resolve;}),sendEmail:async message=>messages.push(message)});
  const first=service.sendReport('owner',body);
  await assert.rejects(service.sendReport('owner',body),{code:'REPORT_BUSY',retry_after_seconds:60});
  while(!finish)await new Promise(resolve=>setImmediate(resolve));
  finish(csvFiles);
  const result=await first;
  assert.equal(result.retry_after_seconds,60);
  assert.equal(messages.length,1);
  assert.equal(messages[0].to,'owner@example.test');
});

test('REPORT-06 prazo cancela antes do Gmail e perda de verificacao impede envio',async()=>{
  const database=fakeDatabase();let finish;let sent=0;
  const service=createReportEmailService({database,emailEnabled:true,deadlineMs:30,renderAttachments:()=>new Promise(resolve=>{finish=resolve;}),sendEmail:async()=>{sent++;}});
  await assert.rejects(service.sendReport('owner',body),{code:'REPORT_UNAVAILABLE'});
  finish(csvFiles);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent,0);
  database.setVerified(false);
  const second=createReportEmailService({database,emailEnabled:true,renderAttachments:async()=>csvFiles,sendEmail:async()=>{sent++;}});
  await assert.rejects(second.sendReport('owner',body),{code:'EMAIL_NOT_VERIFIED'});
  assert.equal(sent,0);
});

test('REPORT-07 linhas com varias quebras nunca criam pagina automatica sem cabecalho',async()=>{
  const PDFDocument=require('pdfkit');
  const originalPage=PDFDocument.prototype.addPage,originalText=PDFDocument.prototype.text;
  let pages=0,headers=0;
  PDFDocument.prototype.addPage=function(...args){pages++;return originalPage.apply(this,args);};
  PDFDocument.prototype.text=function(value,...args){if(value==='PoupEazy')headers++;return originalText.call(this,value,...args);};
  try{
    const report=reportFixture(74);
    report.dados.transacoes=report.dados.transacoes.map((row,index)=>({...row,
      descricao:'Descrição longa com acentuação de uma compra confirmada. '.repeat(5).slice(0,30+(index*46)%225),
      categoria:'Saúde e cuidados pessoais',origem:'cuidados pessoais'}));
    await renderReportAttachments(report,['pdf']);
    assert.ok(pages>5);
    assert.equal(headers,pages,'Toda pagina precisa receber seu cabecalho, sem quebras implicitas do PDFKit.');
  }finally{
    PDFDocument.prototype.addPage=originalPage;PDFDocument.prototype.text=originalText;
  }
});
