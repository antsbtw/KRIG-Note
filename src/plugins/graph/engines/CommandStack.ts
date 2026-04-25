/**
 * CommandStack — 撤销/重做
 *
 * 所有"会改变图数据"的操作都包装成 Command 走这里：
 * - execute() 立刻执行并 push 到 undo 栈
 * - undo() 弹一个 → 执行其 undo() → push 到 redo 栈
 * - redo() 弹一个 → 执行其 execute() → push 到 undo 栈
 * - 任何新 execute 会清空 redo 栈
 *
 * 后续接 SurrealDB 持久化时，每个 Command 内部既改内存数据也写库。
 */

export interface Command {
  /** 显示名（debug 用） */
  readonly name: string;
  execute(): void;
  undo(): void;
}

export class CommandStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  execute(cmd: Command): void {
    cmd.execute();
    this.undoStack.push(cmd);
    this.redoStack.length = 0;
  }

  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.execute();
    this.undoStack.push(cmd);
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }
}
