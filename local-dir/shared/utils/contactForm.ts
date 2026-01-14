export const contactForm = async ({ values, pageName }) => {
  const portalId = "8175341"
  const formGuid = "ac7e2b84-c29a-4ca1-a154-3770467b6ea0"

  const payload = {
    fields: [
      {
        name: "email",
        value: values.email,
      },
      {
        name: "name",
        value: values.name,
      },
      {
        name: "message",
        value: values.message,
      },
    ],
    context: {
      pageUri: "veryfront.com",
      pageName: pageName || "unset",
    },
  }

  var formdata = new FormData()

  formdata.append(
    "hs_context",
    JSON.stringify({
      source: "forms-embed-1.3479",
      pageUri: "veryfront.com",
      pageName: pageName || "unset",
      pageTitle: pageName || "unset",
    }),
  )

  formdata.append("email", values.email)
  formdata.append("message", values.message)
  formdata.append("name", values.name)

  return fetch(
    `https://forms.hsforms.com/submissions/v3/public/submit/formsnext/multipart/${portalId}/${formGuid}/json`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      body: formdata,
    },
  )
}
