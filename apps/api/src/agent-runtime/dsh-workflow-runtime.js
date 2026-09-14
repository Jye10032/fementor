const { randomUUID } = require('crypto');
const { AgentRuntimeError } = require('./contracts');

const WORKFLOW_DEFINITIONS = Object.freeze({
  'evaluation-input-check': Object.freeze({
    meta: Object.freeze({
      name: 'evaluation-input-check',
      description: 'Validate one bounded FEMentor evaluation input without external side effects.',
    }),
    script: [
      "phase('validate-input')",
      "const question = typeof args?.question === 'string' ? args.question.trim() : ''",
      "const answer = typeof args?.answer === 'string' ? args.answer.trim() : ''",
      'const errors = []',
      "if (!question) errors.push('question is required')",
      "if (!answer) errors.push('answer is required')",
      "log(errors.length === 0 ? 'input-valid' : 'input-invalid')",
      'return {',
      '  valid: errors.length === 0,',
      '  errors,',
      '  questionLength: question.length,',
      '  answerLength: answer.length,',
      '}',
    ].join('\n'),
  }),
});

class DshWorkflowRuntime {
  constructor({ createId = randomUUID } = {}) {
    this.createId = createId;
    this.context = null;
    this.subagentFiber = null;
    this.engineFiber = null;
    this.unregisterProvider = null;
    this.startPromise = null;
    this.disposePromise = null;
  }

  async start() {
    if (this.context) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = (async () => {
      const [{ Context }, { default: SubagentRuntime }, { default: WorkerThreadWorkflowEngine }] =
        await Promise.all([
          import('@deepseek-ai/cordis'),
          import('@deepseek-ai/dsh-subagent'),
          import('@deepseek-ai/dsh-workflow-worker-thread'),
        ]);
      const context = new Context();
      let subagentFiber;
      let unregisterProvider;
      let engineFiber;
      try {
        subagentFiber = await context.plugin(SubagentRuntime);
        unregisterProvider = context.subagents.registerProvider({
          name: 'fementor-disabled',
          capabilities: {
            outputSchema: false,
            depthLimit: false,
            toolFilter: false,
            persona: false,
          },
          inheritsParentContext: false,
          async start() {
            throw new Error('subagents are disabled for FEMentor fixed workflows');
          },
        });
        engineFiber = await context.plugin(WorkerThreadWorkflowEngine, {
          provider: 'fementor-disabled',
          maxConcurrentAgents: 1,
          maxTotalAgents: 1,
          maxItemsPerCall: 32,
          syncTimeoutMs: 1000,
          disposeGraceMs: 1000,
        });

        this.context = context;
        this.subagentFiber = subagentFiber;
        this.engineFiber = engineFiber;
        this.unregisterProvider = unregisterProvider;
      } catch (error) {
        if (unregisterProvider) await Promise.resolve(unregisterProvider());
        if (engineFiber) await engineFiber.dispose();
        if (subagentFiber) await subagentFiber.dispose();
        throw error;
      }
    })();

    try {
      await this.startPromise;
    } catch (error) {
      this.startPromise = null;
      await this.dispose();
      throw new AgentRuntimeError('runtime_unavailable', error.message, { cause: error });
    }
  }

  async run(name, args, { signal } = {}) {
    const definition = WORKFLOW_DEFINITIONS[String(name || '').trim()];
    if (!definition) {
      throw new AgentRuntimeError('unsupported_task', `unknown dsh workflow: ${name}`);
    }
    await this.start();

    let run;
    try {
      run = this.context.workflowEngine.start({
        script: definition.script,
        meta: definition.meta,
        args: args || {},
        parent: { id: `fementor-workflow-${this.createId()}`, options: {} },
        signal,
        maxTotalAgents: 1,
      });
      const result = await run.result;
      if (result.stopReason !== 'completed') {
        throw new AgentRuntimeError(
          result.stopReason === 'cancelled' ? 'run_cancelled' : 'execution_failed',
          result.error || `workflow stopped: ${result.stopReason}`,
        );
      }
      return result.value;
    } catch (error) {
      if (error instanceof AgentRuntimeError) throw error;
      throw new AgentRuntimeError('execution_failed', error.message, { cause: error });
    } finally {
      if (run) await run.dispose();
    }
  }

  async dispose() {
    if (this.disposePromise) return this.disposePromise;
    this.disposePromise = (async () => {
      if (this.unregisterProvider) await Promise.resolve(this.unregisterProvider());
      if (this.engineFiber) await this.engineFiber.dispose();
      if (this.subagentFiber) await this.subagentFiber.dispose();
      this.context = null;
      this.subagentFiber = null;
      this.engineFiber = null;
      this.unregisterProvider = null;
      this.startPromise = null;
    })();
    try {
      await this.disposePromise;
    } finally {
      this.disposePromise = null;
    }
  }
}

module.exports = {
  DshWorkflowRuntime,
  WORKFLOW_DEFINITIONS,
};
