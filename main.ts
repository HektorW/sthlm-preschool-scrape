import { stringify } from 'jsr:@std/csv'
import { parseArgs } from 'jsr:@std/cli/parse-args'
import { DOMParser } from 'jsr:@b-fuze/deno-dom'

type Preschool = {
  name: string
  region: string
  link: string
  emails: Array<{
    email: string
    name: string
    role?: string
  }>
}

type PageInitialDataRenderData = {
  initialData: {
    serviceUnits: ServiceUnit[]
    serviceTypes: Array<{
      id: number
      name: string
    }>
  }
}

type ServiceUnit = {
  id: number
  serviceTypeId: number
  locationNorth: number
  locationEast: number
  name: string
  imagePath: string
  address: string
  regions: string
  selfLink: string
}

const rootUrl = 'https://forskola.stockholm'
const listingUrl = `${rootUrl}/hitta-forskola`
const pageCount = 56
const defaultFilename = 'forskolor.csv'

async function fetchNextPage(pageIndex: number): Promise<Preschool[]> {
  const pageUrl = `${listingUrl}?sida=${pageIndex}`
  console.log(`Fetching page - %c${pageUrl}`, 'color: yellow')

  const response = await fetch(pageUrl)
  const text = await response.text()

  const match = text.match(
    /ReactDOM\.render\(React\.createElement\(ServiceUnits\.App, (.+)\), document\.getElement/
  )

  if (!match) {
    return []
  }

  const [, initialDataStr] = match
  const { initialData } = JSON.parse(
    initialDataStr
  ) as PageInitialDataRenderData

  console.log(`Found ${initialData.serviceUnits.length} service units.`)

  const allPreschools: Preschool[] = []
  for (const serviceUnit of initialData.serviceUnits) {
    try {
      const parsedPreschool = await scrapePreschool(serviceUnit)
      allPreschools.push(parsedPreschool)
    } catch (error) {
      console.log(
        `Failed to scrape preschool (%c${serviceUnit.name})`,
        'color: red'
      )
      console.error(error)
    }
  }

  const nextPageIndex = pageIndex >= pageCount ? null : pageIndex + 1
  if (nextPageIndex !== null) {
    allPreschools.push(...(await fetchNextPage(nextPageIndex)))
  }

  return allPreschools
}

async function scrapePreschool(serviceUnit: ServiceUnit): Promise<Preschool> {
  const serviceUnitUrl = `${rootUrl}${serviceUnit.selfLink}`

  console.log(
    `Fetching preschool - %c${serviceUnit.name}%c - (%c${serviceUnitUrl}%c)`,
    'color: green',
    'color: initial',
    'color: green',
    'color: initial'
  )

  const response = await fetch(serviceUnitUrl)
  const text = await response.text()

  const document = new DOMParser().parseFromString(text, 'text/html')

  const emails: Preschool['emails'] = []
  const contactItems = document.querySelectorAll('.unit-contact')
  for (const contactItem of contactItems) {
    const emailMatch = contactItem.innerHTML.match(/"mailto:(.+)"/)
    if (!emailMatch) {
      // Ignore contact items without email
      continue
    }

    const [, email] = emailMatch
    const role = contactItem.querySelector('.unit-contact__title')?.innerText
    const name =
      contactItem.querySelector('.unit-contact__name')?.innerText ?? '-'

    emails.push({
      email,
      name,
      role,
    })
  }

  console.log(
    `Scraped preschool - %c${serviceUnit.name}%c - found ${emails.length} emails`,
    'color: green',
    'color: initial'
  )

  return {
    name: serviceUnit.name,
    region: serviceUnit.regions,

    link: serviceUnitUrl,

    emails,
  }
}

async function writePreschoolsToCsv(preschools: Preschool[], filename: string) {
  const columnEmail = 'email'
  const columnPreschoolName = 'preschool'
  const columnName = 'name'
  const columnRole = 'role'

  type CsvRow = {
    [columnEmail]: string
    [columnPreschoolName]: string
    [columnName]: string
    [columnRole]: string
  }

  const csvRowsMap = new Map<string, CsvRow>()

  for (const preschool of preschools) {
    for (const email of preschool.emails) {
      if (!csvRowsMap.has(email.email)) {
        csvRowsMap.set(email.email, {
          email: email.email,
          preschool: preschool.name,
          name: email.name,
          role: email.role ?? '',
        })
      }
    }
  }

  const csvRows: CsvRow[] = [...csvRowsMap.values()]

  const csvStr = stringify(csvRows, {
    columns: [
      { header: 'Email', prop: columnEmail },
      { header: 'Förskola', prop: columnPreschoolName },
      { header: 'Namn', prop: columnName },
      { header: 'Roll', prop: columnRole },
    ],
  })

  await Deno.writeTextFile(filename, csvStr)
}

if (import.meta.main) {
  const parsedArgs = parseArgs(Deno.args, {
    string: ['filename'],
    default: { filename: defaultFilename },
  })

  const allPreschools = await fetchNextPage(1)

  await writePreschoolsToCsv(allPreschools, parsedArgs.filename)
}
