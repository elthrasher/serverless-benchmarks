import * as sst from "@serverless-stack/resources";

export default class FrontendStack extends sst.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const { api } = props;

    // Define our React app
    const site = new sst.ReactStaticSite(this, "ReactSite", {
      path: "frontend",
      // Pass in our environment variables
      environment: {
        REACT_APP_API_URL: api.customDomainUrl || api.url,
      },
    });

    // Show the url in the output
    this.addOutputs({
      SiteUrl: site.customDomainUrl || site.url,
    });
  }
}
