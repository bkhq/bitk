export class RingBuffer<T> {
  private buf: (T | undefined)[]
  private head = 0
  private count = 0

  constructor(private readonly capacity: number) {
    this.buf = Array.from<T | undefined>({ length: capacity })
  }

  push(item: T): void {
    const idx = (this.head + this.count) % this.capacity
    this.buf[idx] = item
    if (this.count < this.capacity) {
      this.count++
    } else {
      this.head = (this.head + 1) % this.capacity
    }
  }

  toArray(): T[] {
    const result: T[] = []
    for (let i = 0; i < this.count; i++) {
      result.push(this.buf[(this.head + i) % this.capacity] as T)
    }
    return result
  }

  get length(): number {
    return this.count
  }

  clear(): void {
    this.head = 0
    this.count = 0
  }
}
