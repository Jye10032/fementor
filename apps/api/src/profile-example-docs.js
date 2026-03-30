const path = require('path');
const { getUserById, setActiveJdFile, setActiveResumeFile } = require('./db');
const { ensureLocalUserProfile } = require('./request-context');
const { saveJdDoc, listJdDocs } = require('./doc');
const { saveResumeDoc, listResumeDocs } = require('./resume');

const RESUME_EXAMPLE_FILENAME = '匿名简历示例.md';
const JD_EXAMPLE_FILENAME = '通用前端JD示例.md';

const resumeExampleSummary =
  '3年前端开发经验，聚焦企业级Web应用与增长场景，熟悉 React / Next.js / TypeScript / Tailwind CSS，具备组件化建设、复杂交互、性能优化与跨团队协作经验。';

const resumeExampleText = [
  '# 匿名简历示例',
  '',
  '## 候选人概况',
  '- 3年前端开发经验，负责企业级 Web 应用与增长型活动页的设计和交付。',
  '- 熟悉从需求拆解、技术方案评审到上线复盘的完整研发流程。',
  '- 能独立推进中等复杂度模块，也能与产品、设计、后端协作完成跨角色交付。',
  '',
  '## 核心技能',
  '- React / Next.js / TypeScript / Tailwind CSS',
  '- 组件库建设、复杂表单、数据可视化、性能优化',
  '- REST / GraphQL 接口联调、埋点分析、单元测试与 E2E 测试',
  '',
  '## 项目经历',
  '### 企业管理平台重构',
  '- 主导旧后台系统迁移到 Next.js + TypeScript，拆分通用页面骨架与业务组件，提升复杂页面开发效率与可维护性。',
  '- 推动筛选、表格、弹窗、权限控制等模块复用，减少重复实现并统一交互体验。',
  '- 联动后端梳理接口边界与错误处理策略，上线后核心流程报错率明显下降。',
  '',
  '### 用户增长活动页体系',
  '- 负责多场活动页模板化建设，支持不同主题快速复用并按渠道灵活配置。',
  '- 通过资源优化、按需加载与埋点监控，改善首屏加载速度与转化链路分析能力。',
  '',
  '## 工作方式',
  '- 习惯先抽象问题再落地实现，能够在多方协作中推动方案对齐。',
  '- 会基于用户反馈和线上数据持续迭代，关注可维护性与长期交付效率。',
].join('\n');

const jdExampleText = [
  '# 通用前端 JD 示例',
  '',
  '## 岗位名称',
  '前端开发工程师',
  '',
  '## 岗位职责',
  '- 负责公司核心 Web 产品的前端开发与体验优化，参与需求评审、技术方案设计和上线交付。',
  '- 与产品、设计、后端协作推进复杂功能落地，确保交互一致性、性能表现与可维护性。',
  '- 参与组件体系、工程化流程、监控告警和质量保障能力建设，提升团队整体研发效率。',
  '',
  '## 任职要求',
  '- 熟悉 JavaScript / TypeScript，具备 React 或 Next.js 项目经验。',
  '- 理解组件化、状态管理、接口联调、浏览器渲染机制与常见性能优化手段。',
  '- 具备良好的沟通能力和问题拆解能力，能够独立推进中等复杂度需求。',
  '',
  '## 加分项',
  '- 有 B 端系统、数据可视化、低代码、AI 应用或跨端项目经验。',
  '- 有测试体系建设、工程化治理或稳定性优化实践。',
].join('\n');

const findExistingResumeExample = (userId) => {
  const resumeDocs = listResumeDocs(userId);
  return resumeDocs.find((item) =>
    item.name === `resume-${RESUME_EXAMPLE_FILENAME}`
    || item.original_filename === RESUME_EXAMPLE_FILENAME
    || item.name.startsWith('resume-匿名简历示例')
  ) || null;
};

const findExistingJdExample = (userId) => {
  const jdDocs = listJdDocs(userId);
  return jdDocs.find((item) =>
    item.name === `jd-${JD_EXAMPLE_FILENAME}` || item.name.startsWith('jd-通用前端JD示例')
  ) || null;
};

const ensureExampleProfileDocs = ({ userId, authUser = null }) => {
  ensureLocalUserProfile({ userId, authUser });

  const existingResume = findExistingResumeExample(userId);
  const existingJd = findExistingJdExample(userId);

  const resumePath = existingResume?.path || saveResumeDoc({
    userId,
    resumeText: resumeExampleText,
    filename: RESUME_EXAMPLE_FILENAME,
    summary: resumeExampleSummary,
    originalFilename: RESUME_EXAMPLE_FILENAME,
  });
  const jdPath = existingJd?.path || saveJdDoc({
    userId,
    jdText: jdExampleText,
    filename: JD_EXAMPLE_FILENAME,
  });

  const resumeName = path.basename(resumePath);
  const jdName = path.basename(jdPath);
  const user = getUserById(userId);
  const resumeDocs = listResumeDocs(userId);
  const jdDocs = listJdDocs(userId);

  if (user && !user.active_resume_file && resumeDocs.length === 1) {
    setActiveResumeFile({
      userId,
      fileName: resumeName,
      resumeSummary: resumeExampleSummary,
    });
  }

  if (user && !user.active_jd_file && jdDocs.length === 1) {
    setActiveJdFile({
      userId,
      fileName: jdName,
    });
  }

  return {
    resumeName,
    jdName,
  };
};

module.exports = {
  RESUME_EXAMPLE_FILENAME,
  JD_EXAMPLE_FILENAME,
  ensureExampleProfileDocs,
};
