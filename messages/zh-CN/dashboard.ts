import { dashboard as english } from '../en/dashboard';
import type { MessageShape } from '@/i18n/message-types';

export const dashboard = {
  activeSession: '正在进行的训练',
  sessionFallback: '训练',
  startedOn: '{name} 开始于 {date}',
  resumeSession: '继续训练',
  noActiveProgram: '暂无启用的训练计划',
  noActiveProgramDescription: '请先启用一个训练计划，再开始训练。',
  viewPrograms: '查看训练计划',
  emptyProgram: '空训练计划',
  emptyProgramDescription: '{name} 尚未配置训练内容。',
  configureProgram: '配置训练计划',
  startSession: '开始训练',
  activeProgram: '当前训练计划：{name}',
  chooseSession: '选择训练',
  programSessions: '计划中的训练',
  insight: {
    deloadTitle: '可能需要安排恢复',
    stalledTitle: '{count, plural, other {有 # 个动作的训练表现停滞}}',
    stalledDetail:
      '{count, plural, =1 {{names} 近期没有明显进步。可以尝试小幅调整重量、次数或动作技术。} other {{names} 近期没有明显进步。请查看训练进度页面，了解可以调整的方面。}}',
    prTitle: '刷新个人纪录',
    prWeightDetail: '你在上次训练中刷新了 {name} 的单组最大重量纪录，继续保持！',
    prOneRmDetail: '你在上次训练中刷新了 {name} 的估算 1RM 纪录，继续保持！',
    consistentTitle: '训练规律保持得不错',
    consistentDetail: '本周已训练 {count, plural, other {# 天}}，继续保持！',
    deloadStalledReason: '{count, plural, other {有 # 个动作的训练表现停滞：{names}。}}',
    deloadReadinessReason:
      '最近 {checkins, plural, other {# 次状态评估}}的平均状态评分为 {average}/5。',
  },
} satisfies MessageShape<typeof english>;
