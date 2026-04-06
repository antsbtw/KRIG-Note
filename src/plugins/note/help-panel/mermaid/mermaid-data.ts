/**
 * mermaid-data — Mermaid 图表模板数据（按分类组织）
 *
 * 每个模板包含：
 * - label: 卡片显示名称
 * - preview: 用于 SVG 缩略图渲染的完整源码
 * - code: 插入编辑器的源码
 *
 * 基于 Mermaid v11 官方文档。
 */

export interface MermaidTemplate {
  id: string;
  label: string;
  /** 用于渲染预览缩略图的 Mermaid 源码 */
  preview: string;
  /** 插入编辑器的代码 */
  code: string;
}

export interface MermaidCategory {
  id: string;
  name: string;
  templates: MermaidTemplate[];
}

export const MERMAID_CATEGORIES: MermaidCategory[] = [
  // ═══════════════════════════════════════════════════════════
  // Syntax — 跨图表通用元素
  // ═══════════════════════════════════════════════════════════
  {
    id: 'syntax',
    name: 'Syntax',
    templates: [
      // ── Arrows & Connectors ──
      { id: 'syn-arrow-solid', label: 'Solid Arrow (-->)', preview: 'flowchart LR\n  A --> B', code: 'A --> B' },
      { id: 'syn-arrow-line', label: 'Line, No Arrow (---)', preview: 'flowchart LR\n  A --- B', code: 'A --- B' },
      { id: 'syn-arrow-dotted', label: 'Dotted Arrow (-.->)', preview: 'flowchart LR\n  A -.-> B', code: 'A -.-> B' },
      { id: 'syn-arrow-thick', label: 'Thick Arrow (==>)', preview: 'flowchart LR\n  A ==> B', code: 'A ==> B' },
      { id: 'syn-arrow-circle', label: 'Circle End (--o)', preview: 'flowchart LR\n  A --o B', code: 'A --o B' },
      { id: 'syn-arrow-cross', label: 'Cross End (--x)', preview: 'flowchart LR\n  A --x B', code: 'A --x B' },
      { id: 'syn-arrow-bidir', label: 'Bidirectional (<-->)', preview: 'flowchart LR\n  A <--> B', code: 'A <--> B' },
      { id: 'syn-arrow-invisible', label: 'Invisible Link (~~~)', preview: 'flowchart LR\n  A ~~~ B', code: 'A ~~~ B' },
      { id: 'syn-arrow-label', label: 'Labeled Arrow', preview: 'flowchart LR\n  A -- text --> B', code: 'A -- text --> B' },
      { id: 'syn-arrow-long', label: 'Long Arrow (---->)', preview: 'flowchart LR\n  A ----> B', code: 'A ----> B' },

      // ── Node Shapes ──
      { id: 'syn-node-rect', label: 'Rectangle [Label]', preview: 'flowchart LR\n  A[Rectangle]', code: 'A[Label]' },
      { id: 'syn-node-round', label: 'Rounded (Label)', preview: 'flowchart LR\n  A(Rounded)', code: 'A(Label)' },
      { id: 'syn-node-circle', label: 'Circle ((Label))', preview: 'flowchart LR\n  A((Circle))', code: 'A((Label))' },
      { id: 'syn-node-diamond', label: 'Diamond {Label}', preview: 'flowchart LR\n  A{Diamond}', code: 'A{Label}' },
      { id: 'syn-node-hex', label: 'Hexagon {{Label}}', preview: 'flowchart LR\n  A{{Hexagon}}', code: 'A{{Label}}' },
      { id: 'syn-node-para', label: 'Parallelogram [/Label/]', preview: 'flowchart LR\n  A[/Parallelogram/]', code: 'A[/Label/]' },
      { id: 'syn-node-cylinder', label: 'Cylinder [(Label)]', preview: 'flowchart LR\n  A[(Database)]', code: 'A[(Label)]' },
      { id: 'syn-node-stadium', label: 'Stadium ([Label])', preview: 'flowchart LR\n  A([Stadium])', code: 'A([Label])' },
      { id: 'syn-node-subroutine', label: 'Subroutine [[Label]]', preview: 'flowchart LR\n  A[[Subroutine]]', code: 'A[[Label]]' },

      // ── Styling ──
      { id: 'syn-style-fill', label: 'style fill', preview: 'flowchart LR\n  A[Styled]\n  style A fill:#264653,color:#e9c46a', code: 'style nodeId fill:#hex,color:#hex' },
      { id: 'syn-classdef', label: 'classDef + class', preview: 'flowchart LR\n  A[Node]:::highlight\n  classDef highlight fill:#264653,stroke:#2a9d8f,color:#e9c46a', code: 'classDef className fill:#hex,stroke:#hex,color:#hex\nclass nodeId className' },
      { id: 'syn-linkstyle', label: 'linkStyle', preview: 'flowchart LR\n  A --> B --> C\n  linkStyle 0 stroke:#f66,stroke-width:3px', code: 'linkStyle 0 stroke:#hex,stroke-width:2px' },

      // ── Directives ──
      { id: 'syn-dir-subgraph', label: 'Subgraph', preview: 'flowchart TD\n  subgraph Group\n    A --> B\n  end\n  B --> C', code: 'subgraph Title\n    A --> B\n  end' },
      { id: 'syn-dir-comment', label: 'Comment (%%)', preview: 'flowchart LR\n  A --> B', code: '%% This is a comment' },
      { id: 'syn-dir-direction', label: 'Direction (LR/TD/…)', preview: 'flowchart LR\n  A --> B --> C', code: '%% direction: LR (Left→Right), TD (Top→Down), BT, RL' },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // Flowchart
  // ═══════════════════════════════════════════════════════════
  {
    id: 'flowchart',
    name: 'Flowchart',
    templates: [
      {
        id: 'flow-linear',
        label: 'Linear Flow',
        preview: 'flowchart TD\n  A[Start] --> B[Process] --> C[End]',
        code: 'flowchart TD\n  A[Start] --> B[Process] --> C[End]',
      },
      {
        id: 'flow-decision',
        label: 'Decision Branch',
        preview: 'flowchart TD\n  A[Input] --> B{Valid?}\n  B -- Yes --> C[Process]\n  B -- No --> D[Error]',
        code: 'flowchart TD\n  A[Input] --> B{Valid?}\n  B -- Yes --> C[Process]\n  B -- No --> D[Error]',
      },
      {
        id: 'flow-subgraph',
        label: 'Subgraph',
        preview: 'flowchart TD\n  subgraph sg1 [Module A]\n    direction LR\n    A --> B\n  end\n  sg1 --> C',
        code: 'flowchart TD\n  subgraph sg1 [Module A]\n    direction LR\n    A --> B\n  end\n  sg1 --> C',
      },
      {
        id: 'flow-swimlane',
        label: 'Swimlane',
        preview: 'flowchart LR\n  subgraph Alice\n    A1 --> A2\n  end\n  subgraph Bob\n    B1 --> B2\n  end\n  A2 --> B1',
        code: 'flowchart LR\n  subgraph Alice\n    A1 --> A2\n  end\n  subgraph Bob\n    B1 --> B2\n  end\n  A2 --> B1',
      },
      {
        id: 'flow-styled',
        label: 'Styled + classDef',
        preview: 'flowchart TD\n  classDef error fill:#f66,color:#fff,stroke:#c00\n  A[Start] --> B{OK?}\n  B -- No --> E[Error]:::error\n  B -- Yes --> C[Done]',
        code: 'flowchart TD\n  classDef error fill:#f66,color:#fff,stroke:#c00\n  A[Start] --> B{OK?}\n  B -- No --> E[Error]:::error\n  B -- Yes --> C[Done]',
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // Sequence
  // ═══════════════════════════════════════════════════════════
  {
    id: 'sequence',
    name: 'Sequence',
    templates: [
      {
        id: 'seq-basic',
        label: 'Basic Exchange',
        preview: 'sequenceDiagram\n  participant Alice\n  participant Bob\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi there',
        code: 'sequenceDiagram\n  participant Alice\n  participant Bob\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi there',
      },
      {
        id: 'seq-actors',
        label: 'Actor + Database',
        preview: 'sequenceDiagram\n  actor User\n  participant App\n  participant DB as Database\n  User->>App: Login\n  App->>+DB: Query\n  DB-->>-App: Result\n  App-->>User: Welcome',
        code: 'sequenceDiagram\n  actor User\n  participant App\n  participant DB as Database\n  User->>App: Login\n  App->>+DB: Query\n  DB-->>-App: Result\n  App-->>User: Welcome',
      },
      {
        id: 'seq-loop-alt',
        label: 'Loop + Alt',
        preview: 'sequenceDiagram\n  loop Every minute\n    Client->>Server: Ping\n    Server-->>Client: Pong\n  end\n  alt Success\n    Server->>Client: 200 OK\n  else Failure\n    Server->>Client: 500 Error\n  end',
        code: 'sequenceDiagram\n  loop Every minute\n    Client->>Server: Ping\n    Server-->>Client: Pong\n  end\n  alt Success\n    Server->>Client: 200 OK\n  else Failure\n    Server->>Client: 500 Error\n  end',
      },
      {
        id: 'seq-par',
        label: 'Parallel (par)',
        preview: 'sequenceDiagram\n  par Send Email\n    A->>Email: notify\n  and Send SMS\n    A->>SMS: notify\n  end',
        code: 'sequenceDiagram\n  par Send Email\n    A->>Email: notify\n  and Send SMS\n    A->>SMS: notify\n  end',
      },
      {
        id: 'seq-critical',
        label: 'Critical Region',
        preview: 'sequenceDiagram\n  critical Establish connection\n    A->>B: connect\n  option Timeout\n    A->>A: retry\n  option Error\n    A->>A: log error\n  end',
        code: 'sequenceDiagram\n  critical Establish connection\n    A->>B: connect\n  option Timeout\n    A->>A: retry\n  option Error\n    A->>A: log error\n  end',
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // Class
  // ═══════════════════════════════════════════════════════════
  {
    id: 'class',
    name: 'Class',
    templates: [
      {
        id: 'cls-single',
        label: 'Single Class',
        preview: 'classDiagram\n  class Animal {\n    +String name\n    -int age\n    +speak() String\n  }',
        code: 'classDiagram\n  class Animal {\n    +String name\n    -int age\n    +speak() String\n  }',
      },
      {
        id: 'cls-inherit',
        label: 'Inheritance',
        preview: 'classDiagram\n  Animal <|-- Dog\n  Animal <|-- Cat\n  Animal : +String name\n  class Dog {\n    +String breed\n    +fetch()\n  }',
        code: 'classDiagram\n  Animal <|-- Dog\n  Animal <|-- Cat\n  Animal : +String name\n  class Dog {\n    +String breed\n    +fetch()\n  }',
      },
      {
        id: 'cls-interface',
        label: 'Interface + Realization',
        preview: 'classDiagram\n  class Flyable {\n    <<interface>>\n    +fly()\n  }\n  Duck ..|> Flyable',
        code: 'classDiagram\n  class Flyable {\n    <<interface>>\n    +fly()\n  }\n  Duck ..|> Flyable',
      },
      {
        id: 'cls-cardinality',
        label: 'Cardinality',
        preview: 'classDiagram\n  Customer "1" --> "0..*" Order : places\n  Order "1" *-- "1..*" OrderItem : contains',
        code: 'classDiagram\n  Customer "1" --> "0..*" Order : places\n  Order "1" *-- "1..*" OrderItem : contains',
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // ER
  // ═══════════════════════════════════════════════════════════
  {
    id: 'er',
    name: 'ER',
    templates: [
      {
        id: 'er-one-many',
        label: 'One-to-Many',
        preview: 'erDiagram\n  USER ||--o{ ORDER : places\n  ORDER ||--|{ ORDER_ITEM : contains',
        code: 'erDiagram\n  USER ||--o{ ORDER : places\n  ORDER ||--|{ ORDER_ITEM : contains',
      },
      {
        id: 'er-attrs',
        label: 'With Attributes + Keys',
        preview: 'erDiagram\n  USER {\n    int id PK\n    string name\n    string email UK\n  }\n  ORDER {\n    int id PK\n    int user_id FK\n    date created_at\n  }\n  USER ||--o{ ORDER : places',
        code: 'erDiagram\n  USER {\n    int id PK\n    string name\n    string email UK\n  }\n  ORDER {\n    int id PK\n    int user_id FK\n    date created_at\n  }\n  USER ||--o{ ORDER : places',
      },
      {
        id: 'er-many-many',
        label: 'Many-to-Many',
        preview: 'erDiagram\n  STUDENT }|--|{ COURSE : enrolls',
        code: 'erDiagram\n  STUDENT }|--|{ COURSE : enrolls',
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════
  {
    id: 'state',
    name: 'State',
    templates: [
      {
        id: 'st-simple',
        label: 'Simple Transition',
        preview: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Active : start\n  Active --> Idle : pause\n  Active --> [*] : stop',
        code: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Active : start\n  Active --> Idle : pause\n  Active --> [*] : stop',
      },
      {
        id: 'st-choice',
        label: 'Choice',
        preview: 'stateDiagram-v2\n  [*] --> Check\n  state Check <<choice>>\n  Check --> Valid : is valid\n  Check --> Invalid : not valid',
        code: 'stateDiagram-v2\n  [*] --> Check\n  state Check <<choice>>\n  Check --> Valid : is valid\n  Check --> Invalid : not valid',
      },
      {
        id: 'st-fork-join',
        label: 'Fork / Join',
        preview: 'stateDiagram-v2\n  [*] --> Fork\n  state Fork <<fork>>\n  Fork --> TaskA\n  Fork --> TaskB\n  TaskA --> Join\n  TaskB --> Join\n  state Join <<join>>\n  Join --> [*]',
        code: 'stateDiagram-v2\n  [*] --> Fork\n  state Fork <<fork>>\n  Fork --> TaskA\n  Fork --> TaskB\n  TaskA --> Join\n  TaskB --> Join\n  state Join <<join>>\n  Join --> [*]',
      },
      {
        id: 'st-concurrency',
        label: 'Concurrency',
        preview: 'stateDiagram-v2\n  [*] --> Running\n  state Running {\n    [*] --> Downloading\n    Downloading --> Done\n    --\n    [*] --> Processing\n    Processing --> Done\n  }\n  Running --> [*]',
        code: 'stateDiagram-v2\n  [*] --> Running\n  state Running {\n    [*] --> Downloading\n    Downloading --> Done\n    --\n    [*] --> Processing\n    Processing --> Done\n  }\n  Running --> [*]',
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // Gantt
  // ═══════════════════════════════════════════════════════════
  {
    id: 'gantt',
    name: 'Gantt',
    templates: [
      {
        id: 'gantt-basic',
        label: 'Basic Timeline',
        preview: 'gantt\n  title Project Plan\n  dateFormat YYYY-MM-DD\n  section Phase 1\n  Task A :a1, 2024-01-01, 7d\n  Task B :after a1, 5d',
        code: 'gantt\n  title Project Plan\n  dateFormat YYYY-MM-DD\n  section Phase 1\n  Task A :a1, 2024-01-01, 7d\n  Task B :after a1, 5d',
      },
      {
        id: 'gantt-milestone',
        label: 'Milestone',
        preview: 'gantt\n  title Release Plan\n  dateFormat YYYY-MM-DD\n  section Deploy\n  Prepare  :p1, 2024-02-01, 3d\n  Launch   :milestone, after p1, 0d',
        code: 'gantt\n  title Release Plan\n  dateFormat YYYY-MM-DD\n  section Deploy\n  Prepare  :p1, 2024-02-01, 3d\n  Launch   :milestone, after p1, 0d',
      },
      {
        id: 'gantt-status',
        label: 'Task Status (done/active/crit)',
        preview: 'gantt\n  dateFormat YYYY-MM-DD\n  section Tasks\n  Completed :done,   d1, 2024-01-01, 3d\n  Active    :active, d2, after d1, 5d\n  Critical  :crit,   d3, after d2, 3d',
        code: 'gantt\n  dateFormat YYYY-MM-DD\n  section Tasks\n  Completed :done,   d1, 2024-01-01, 3d\n  Active    :active, d2, after d1, 5d\n  Critical  :crit,   d3, after d2, 3d',
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // Mindmap
  // ═══════════════════════════════════════════════════════════
  {
    id: 'mindmap',
    name: 'Mindmap',
    templates: [
      {
        id: 'mm-basic',
        label: 'Basic Mindmap',
        preview: 'mindmap\n  root((Topic))\n    Branch A\n      Leaf 1\n      Leaf 2\n    Branch B\n      Leaf 3',
        code: 'mindmap\n  root((Topic))\n    Branch A\n      Leaf 1\n      Leaf 2\n    Branch B\n      Leaf 3',
      },
      {
        id: 'mm-shapes',
        label: 'Node Shapes',
        preview: 'mindmap\n  root((Center))\n    [Square Node]\n    (Rounded Node)\n    ))Bang Node((\n    )Cloud Node(\n    {{Hexagon Node}}',
        code: 'mindmap\n  root((Center))\n    [Square Node]\n    (Rounded Node)\n    ))Bang Node((\n    )Cloud Node(\n    {{Hexagon Node}}',
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // Git
  // ═══════════════════════════════════════════════════════════
  {
    id: 'git',
    name: 'Git',
    templates: [
      {
        id: 'git-feature',
        label: 'Feature Branch',
        preview: 'gitGraph\n  commit\n  branch feature\n  checkout feature\n  commit\n  commit\n  checkout main\n  merge feature',
        code: 'gitGraph\n  commit\n  branch feature\n  checkout feature\n  commit\n  commit\n  checkout main\n  merge feature',
      },
      {
        id: 'git-tags',
        label: 'Tags',
        preview: 'gitGraph\n  commit\n  commit tag: "v1.0.0"\n  branch develop\n  checkout develop\n  commit\n  checkout main\n  merge develop tag: "v1.1.0"',
        code: 'gitGraph\n  commit\n  commit tag: "v1.0.0"\n  branch develop\n  checkout develop\n  commit\n  checkout main\n  merge develop tag: "v1.1.0"',
      },
      {
        id: 'git-hotfix',
        label: 'Hotfix',
        preview: 'gitGraph\n  commit\n  branch hotfix\n  checkout hotfix\n  commit id: "fix bug"\n  checkout main\n  merge hotfix tag: "v1.0.1"',
        code: 'gitGraph\n  commit\n  branch hotfix\n  checkout hotfix\n  commit id: "fix bug"\n  checkout main\n  merge hotfix tag: "v1.0.1"',
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // Others
  // ═══════════════════════════════════════════════════════════
  {
    id: 'others',
    name: 'Others',
    templates: [
      {
        id: 'oth-pie',
        label: 'Pie Chart',
        preview: 'pie title Browser Share\n  "Chrome" : 62\n  "Firefox" : 18\n  "Safari" : 20',
        code: 'pie title Chart Title\n  "Category A" : 60\n  "Category B" : 25\n  "Category C" : 15',
      },
      {
        id: 'oth-xychart',
        label: 'XY Bar + Line',
        preview: 'xychart-beta\n  title "Quarterly Sales"\n  x-axis [Q1, Q2, Q3, Q4]\n  y-axis "Revenue ($M)" 0 --> 400\n  bar [120, 200, 150, 300]\n  line [100, 180, 140, 280]',
        code: 'xychart-beta\n  title "Chart Title"\n  x-axis [A, B, C, D]\n  y-axis "Value" 0 --> 100\n  bar [10, 20, 30, 40]\n  line [8, 18, 28, 38]',
      },
      {
        id: 'oth-timeline',
        label: 'Timeline',
        preview: 'timeline\n  title Product History\n  2020 : MVP Launch\n       : First 100 users\n  2022 : v2.0 Release\n  2024 : Enterprise Plan',
        code: 'timeline\n  title History\n  2020 : Event A\n       : Detail\n  2022 : Event B\n  2024 : Event C',
      },
      {
        id: 'oth-kanban',
        label: 'Kanban',
        preview: 'kanban\n  column Todo\n    task1[Write docs]\n    task2[Fix bug]\n  column In Progress\n    task3[Build feature]\n  column Done\n    task4[Ship v1]',
        code: 'kanban\n  column Todo\n    task1[Task 1]\n    task2[Task 2]\n  column In Progress\n    task3[Task 3]\n  column Done\n    task4[Task 4]',
      },
      {
        id: 'oth-quadrant',
        label: 'Quadrant Chart',
        preview: 'quadrantChart\n  title Effort vs Impact\n  x-axis Low Effort --> High Effort\n  y-axis Low Impact --> High Impact\n  quadrant-1 Do it now\n  quadrant-2 Plan it\n  quadrant-3 Skip it\n  quadrant-4 Delegate\n  Task A: [0.2, 0.8]\n  Task B: [0.7, 0.3]',
        code: 'quadrantChart\n  title Effort vs Impact\n  x-axis Low --> High\n  y-axis Low --> High\n  quadrant-1 Do it now\n  quadrant-2 Plan it\n  quadrant-3 Skip it\n  quadrant-4 Delegate\n  Item A: [0.3, 0.8]\n  Item B: [0.7, 0.4]',
      },
    ],
  },
];
