/**
 * @hhpilot/automation-core — публичный API пакета. Используется и apps/cloud-worker
 * (Mongoose-storage), и apps/local-agent (SQLite-storage) — вся логика hh.ru здесь одна.
 */

const { createBrowserContext } = require('./browser');
const { fetchResumeText, extractResumeId } = require('./hh/resume');
const { fetchSimilarVacancies, fetchVacancyDescription } = require('./hh/vacancies');
const { applyToVacancy } = require('./hh/apply');
const { fetchActiveThreads, fetchThreadMessages, sendReply, threadUrl } = require('./hh/negotiations');
const { createSiberiClient } = require('./llm/siberiClient');
const { createCoreApiProxyClient } = require('./llm/coreApiProxyClient');
const { generateCoverLetter } = require('./coverLetter');
const { generateReply } = require('./replyAgent');
const { runForResume, normalizeCompanyName } = require('./applyJob');
const { runOnce: runNegotiationsOnce, deliverPendingClarifications } = require('./negotiationsWatcher');
const { toPlainText } = require('./plainText');
const { classifyOutcome } = require('./outcomeClassifier');

const { parsePortfolioLink } = require('./portfolioLink');

const { cleanProfileList } = require('./resumeProfile');

module.exports = {
  parsePortfolioLink,
  cleanProfileList,
  createBrowserContext,
  hh: {
    fetchResumeText,
    extractResumeId,
    fetchSimilarVacancies,
    fetchVacancyDescription,
    applyToVacancy,
    fetchActiveThreads,
    fetchThreadMessages,
    sendReply,
    threadUrl,
  },
  llm: { createSiberiClient, createCoreApiProxyClient },
  generateCoverLetter,
  generateReply,
  applyJob: { runForResume, normalizeCompanyName },
  negotiationsWatcher: { runOnce: runNegotiationsOnce, deliverPendingClarifications },
  toPlainText,
  classifyOutcome,
};
