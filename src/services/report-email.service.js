const { ApiError } = require('../middleware/errorHandler');
const { GmailEmailError } = require('../config/email');
const { normalizeReportRequest, collectReportSnapshot } = require('./report-data.service');
const { renderReportAttachments } = require('./report-renderer');
let activeReport = false;
function retryError(code, message) {
  const error = new ApiError(429,message,code); error.retry_after_seconds = 60; return error;
}
function createReportEmailService({ database, sendEmail, emailEnabled = false, renderAttachments = renderReportAttachments, deadlineMs = 45000 } = {}) {
  async function sendReport(userId, body) {
    const request = normalizeReportRequest(body);
    if (!emailEnabled) throw new ApiError(503,'O envio de relatorios esta temporariamente indisponivel.','EMAIL_DISABLED');
    if (activeReport) throw retryError('REPORT_BUSY','Outro relatorio esta sendo processado. Tente novamente em um minuto.');
    activeReport = true;
    const controller = new AbortController(); let sending = false;
    let timeout;
    const deadline = new Promise((resolve,reject) => { timeout = setTimeout(() => {
      controller.abort();
      reject(new ApiError(sending ? 502 : 503, sending ? 'Nao foi possivel confirmar o envio. Confira sua caixa de entrada antes de pedir novamente.' : 'O relatorio demorou mais que o permitido. Reduza o pedido e tente novamente.', sending ? 'EMAIL_SEND_UNKNOWN' : 'REPORT_UNAVAILABLE'));
    },Math.min(Math.max(deadlineMs,1),45000)); });
    const task = (async () => {
      const { rows: [claimed] } = await database.query(`UPDATE usuarios SET relatorio_email_solicitado_em=NOW()
        WHERE id=$1 AND email_verificado_em IS NOT NULL
          AND (relatorio_email_solicitado_em IS NULL OR relatorio_email_solicitado_em <= NOW()-INTERVAL '60 seconds') RETURNING id`,[userId]);
      if (!claimed) {
        const { rows: [user] } = await database.query('SELECT email_verificado_em FROM usuarios WHERE id=$1',[userId]);
        if (!user) throw new ApiError(401,'Usuario nao encontrado.');
        if (!user.email_verificado_em) throw new ApiError(403,'Confirme seu e-mail para receber relatorios.','EMAIL_NOT_VERIFIED');
        throw retryError('REPORT_COOLDOWN','Aguarde pelo menos 60 segundos antes de solicitar outro relatorio.');
      }
      const { report } = await collectReportSnapshot({database,userId,request});
      if (controller.signal.aborted) throw new ApiError(503,'O relatorio excedeu o tempo permitido.','REPORT_UNAVAILABLE');
      const attachments = await renderAttachments(report,request.formatos);
      if (controller.signal.aborted) throw new ApiError(503,'O relatorio excedeu o tempo permitido.','REPORT_UNAVAILABLE');
      const { rows: [recipient] } = await database.query('SELECT email, email_verificado_em FROM usuarios WHERE id=$1',[userId]);
      if (!recipient) throw new ApiError(401,'Usuario nao encontrado.');
      if (!recipient.email_verificado_em) throw new ApiError(403,'Confirme seu e-mail para receber relatorios.','EMAIL_NOT_VERIFIED');
      sending = true;
      await sendEmail({ to: recipient.email, subject: 'Seu relatorio do PoupEazy',
        text: `Seu relatório solicitado está nos anexos.\nPeríodo: ${request.data_inicio} a ${request.data_fim}.\nSeções: ${request.secoes.join(', ')}.\n\nEquipe PoupEazy`, attachments },{signal:controller.signal});
      return { message: 'O Gmail aceitou o envio do relatorio. Confira sua caixa de entrada e o spam.', retry_after_seconds: 60 };
    })().catch((error) => {
      if (error instanceof ApiError) throw error;
      const code = error instanceof GmailEmailError ? new GmailEmailError(error.code).code : sending ? 'EMAIL_SEND_UNKNOWN' : 'REPORT_PROCESSING_FAILED';
      console.error(`[report-email] ${code}`);
      if (code === 'EMAIL_SEND_UNKNOWN') throw new ApiError(502,'Nao foi possivel confirmar o envio. Confira sua caixa de entrada antes de pedir novamente.','EMAIL_SEND_UNKNOWN');
      throw new ApiError(503,'Nao foi possivel gerar ou enviar o relatorio agora. Tente novamente mais tarde.','REPORT_UNAVAILABLE');
    }).finally(() => { clearTimeout(timeout); activeReport = false; });
    return Promise.race([task,deadline]);
  }
  return { sendReport };
}
module.exports = { createReportEmailService };
