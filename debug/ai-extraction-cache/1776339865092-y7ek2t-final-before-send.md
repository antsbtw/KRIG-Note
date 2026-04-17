好的，我来生成一段包含多种内容类型的测试对话。

---

## 用户问题

> 请帮我解释欧拉恒等式，并给出一个用 Go 实现复数运算的例子，附带一个流程图说明程序执行过程，最后再画一个 SVG 示意图。

---

## 回答

### 1. 欧拉恒等式（公式）

欧拉恒等式被誉为数学中最优美的等式：

$$
e^{i\pi} + 1 = 0
$$

它是欧拉公式的特例。欧拉公式的一般形式为：

$$
e^{i\theta} = \cos\theta + i\sin\theta
$$

当 $\theta = \pi$ 时，由于 $\cos\pi = -1$，$\sin\pi = 0$，代入得：

$$
e^{i\pi} = -1 + 0i \implies e^{i\pi} + 1 = 0
$$

复数的模（magnitude）定义为：

$$
|z| = \sqrt{a^2 + b^2}, \quad z = a + bi
$$

---

### 2. SVG 示意图 — 复数的极坐标表示
> [!note] 📥 此处图片请点击 Claude 页面的拷贝按钮
> [在 Claude 中查看原图](https://claude.ai/chat/c02c2e45-d3b7-4523-a5d4-0ab2271f604e)

---

### 3. 流程图 — Go 程序执行流程
> [!note] 📥 此处图片请点击 Claude 页面的拷贝按钮
> [在 Claude 中查看原图](https://claude.ai/chat/c02c2e45-d3b7-4523-a5d4-0ab2271f604e)

---

### 4. Go 代码（内联代码块）

```go
package main

import (
	"fmt"
	"math/cmplx"
)

// Complex 封装复数运算工具
type Complex struct {
	Value complex128
}

// NewComplex 构造复数
func NewComplex(real, imag float64) Complex {
	return Complex{Value: complex(real, imag)}
}

// Abs 返回模长
func (c Complex) Abs() float64 {
	return cmplx.Abs(c.Value)
}

// Phase 返回辐角（弧度）
func (c Complex) Phase() float64 {
	return cmplx.Phase(c.Value)
}

// IsOnUnitCircle 判断是否在单位圆上（容差 1e-9）
func (c Complex) IsOnUnitCircle() bool {
	return abs(c.Abs()-1.0) < 1e-9
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

func main() {
	// 欧拉公式：e^(iπ) = cos(π) + i·sin(π)
	z := NewComplex(-1, 0) // e^(iπ)

	fmt.Printf("z = %v\n", z.Value)
	fmt.Printf("|z| = %.6f\n", z.Abs())
	fmt.Printf("arg(z) = %.6f rad\n", z.Phase())
	fmt.Printf("单位圆上: %v\n", z.IsOnUnitCircle())

	// 一般复数示例
	w := NewComplex(3, 4)
	fmt.Printf("\nw = %v\n", w.Value)
	fmt.Printf("|w| = %.6f  (3-4-5 三角形)\n", w.Abs())
}
```

**输出：**
```
z = (-1+0i)
|z| = 1.000000
arg(z) = 3.141593 rad
单位圆上: true

w = (3+4i)
|w| = 5.000000  (3-4-5 三角形)
```

---

### 5. Go 代码附件
> [!note] 📥 此处图片请点击 Claude 页面的拷贝按钮
> [在 Claude 中查看原图](https://claude.ai/chat/c02c2e45-d3b7-4523-a5d4-0ab2271f604e)

---

以上对话包含了以下所有内容类型，可用于提取测试：

- **数学公式**：行内公式 `$...$` 和块级公式 `$$...$$`
- **SVG 图片**：复数极坐标平面示意图（widget 渲染）
- **流程图**：SVG 流程图，含分支判断节点
- **内联代码块**：带语法高亮的 Go 代码片段
- **Go 代码附件**：可下载的 `.go` 文件