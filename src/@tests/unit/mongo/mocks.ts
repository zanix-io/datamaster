// Document type
export interface Document {
  id?: number
  name?: string
}

// Mock mongoose model
export class MockModel {
  private data: Document[]

  constructor(data: Document[]) {
    this.data = data
  }

  public find(filter: Partial<Document>) {
    const filteredData = this.data.filter((doc) =>
      Object.entries(filter).every(([key, value]) => doc[key as keyof Document] === value)
    )

    return {
      limit: function (n: number) {
        return MockModel.chain(filteredData.slice(0, n))
      },
      lean: function () {
        return MockModel.chain(filteredData)
      },
      exec: function () {
        return filteredData
      },
      cursor: function () {
        // Retornamos un objeto iterable async
        return {
          [Symbol.asyncIterator]() {
            let i = 0
            return {
              next: () => {
                if (i < filteredData.length) {
                  return { value: filteredData[i++], done: false }
                } else {
                  return { value: undefined, done: true }
                }
              },
            }
          },
        }
      },
    }
  }

  public static chain(data: Document[]) {
    return {
      limit: function (n: number) {
        return MockModel.chain(data.slice(0, n))
      },
      lean: function () {
        return MockModel.chain(data)
      },
      exec: function () {
        return data
      },
      cursor: function () {
        return {
          [Symbol.asyncIterator]() {
            let i = 0
            return {
              next: () => {
                if (i < data.length) {
                  return { value: data[i++], done: false }
                } else {
                  return { value: undefined, done: true }
                }
              },
            }
          },
        }
      },
    }
  }
}
