import { ProtocolRegistration, ViewType } from '../../shared/types';

/**
 * 协同协议注册表 + 匹配引擎
 *
 * 宽松模式：只管"这两个 View 之间是否允许通信"，
 * 不检查消息内容。允许通信后，所有 message 都转发。
 *
 * 匹配规则：(Left.type+variant, Right.type+variant) → 协议 id 或 null
 * 未匹配的组合 = none，消息不转发。
 */

interface ViewIdentity {
  type: ViewType;
  variant?: string;
}

class ProtocolRegistry {
  private protocols: ProtocolRegistration[] = [];

  /** 注册一个协同协议 */
  register(registration: ProtocolRegistration): void {
    this.protocols.push(registration);
  }

  /**
   * 匹配：给定 Left 和 Right 的身份，返回协议 id 或 null
   * null = 不允许通信（默认 none）
   */
  match(left: ViewIdentity, right: ViewIdentity): string | null {
    for (const reg of this.protocols) {
      if (
        reg.match.left.type === left.type &&
        reg.match.left.variant === left.variant &&
        reg.match.right.type === right.type &&
        reg.match.right.variant === right.variant
      ) {
        return reg.id;
      }
    }
    return null;
  }

  /** 获取所有已注册的协议 */
  getAll(): ProtocolRegistration[] {
    return [...this.protocols];
  }
}

export const protocolRegistry = new ProtocolRegistry();
