# FEMentor 自主面试主 Agent v1

日期：2026-10-15。范围已由用户确认：主 Agent 自主选择下一步和专家能力，执行器由服务端配置。

## 目标与边界

第一版主 Agent、评分专家、出题专家均运行固定版本 Codex 0.162.1。主 Agent 通过系统角色、同源 Skill、当前面试快照和受限工具知道自己的面试职责。FEMentor 程序负责权限、预算、持久化和提交；主 Agent 自主决定澄清、追问、换题、跳过或结束。评分专家只提供评分，出题专家只提供一道题；二者不能继续派生任务。

`INTERVIEW_ORCHESTRATOR=director` 配合 `AGENT_RUNTIME=codex`、统一 pipeline 和 Fastify 主入口启用；raw legacy HTTP 入口显式拒绝 director。缺省仍为已验收 workflow。主 Agent 不能选择 Runtime、模型、路径、URL、租户、数据库语句。第一版不实现 Claude Adapter、并行专家、多实例队列或跨面试长期画像。

每次用户提交创建一个主 run，最多串行调用 2 次专家，主模型请求最多 4 次。每次专家任务一个独立 Sandbox，最多同时存在主/子两个 Sandbox；主 turn 总期限 900000 ms，专家保持 120000 ms 执行期限与 240000 ms 准备期限。子任务回收确认后结果才交给主 Agent。主/子资源都进入既有恢复日志，进程退出后清理，已保存回答由用户显式重试。

## 契约

主 Agent 仅可调用 `run_expert({expert, purpose, topic})`。expert 为 `evaluate_answer` 或 `design_question`；purpose 最多 1000 字，topic 为空或来自宿主允许话题。宿主重新绑定原始题目/回答，模型不能替换它们。工具结果是经过 Schema 校验并持久化的 `{artifact_id, expert, result}`。每个 attempt 的专家结果先存入独立表，再返回；失败 attempt 的结果不能用于另一 attempt 提交。

主最终输出根对象 `decision`，包含 action（clarify/follow_up/next_question/skip/finish）、reply_text、reason、evaluation_ref、question_ref、next_question_id。引用为字符串或 null。只有本 attempt 的评分专家结果可以生成正式分数，主 Agent 不填写分数；追问只能引用本 attempt 的出题产物，换题可以选择批准队列中的题目或出题产物。澄清不创建评分、不消费当前题。跳过不生成评分。结束可以不评分，须真正完成 session；答题后的结束可引用评分。

所有动作由宿主校验引用、当前题状态、owner、attempt 与快照后原子提交。主输出和工具产物未经提交不向候选人流出。候选人材料都作为数据处理，完整答案只进入受控字段，不要求模型凭 prompt 保证权限。

## 连续性与界面

业务会话保存在 PostgreSQL/SQLite，Agent thread 不承担持久化。上下文来自当前完整题目/回答/简历摘要/JD、允许话题、候选题、已完成提交的对话及评分，按 token 预算选择历史。历史不足时明确压缩元数据，不截断当前回答。每个 run 检查实际转发的模型输入预算。

界面保留原评分与恢复流程；澄清后保持当前题，结束后展示已结束状态；刷新从提交结果恢复。专家结果和主决策可审计，但推理原文不展示、不写运行日志。

## 验收

受控工具必须经真实 Codex app-server 0.162.1 验证。未注册工具、跨 turn、并行/超预算专家调用、伪造产物、过期 attempt 均拒绝。验证有评分专家链、无专家澄清链、换题/结束提交、取消传播与沙箱回收；云端验收只使用既有 Railway 测试环境及独立 PostgreSQL。生产配置不改变。
