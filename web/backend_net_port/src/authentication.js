"use strict";

const {
    AuthenticationService,
    JWTStrategy,
} = require("@feathersjs/authentication");

const { LocalStrategy } = require("@feathersjs/authentication-local");
const { OAuthStrategy, oauth } = require("@feathersjs/authentication-oauth");

class GoogleStrategy extends OAuthStrategy {
    async getEntityData(profile) {
        // this will set 'googleId'
        const baseData = await super.getEntityData(profile);

        // this will grab the picture and email address of the Google profile
        return {
            ...baseData,
            profilepicture: profile.picture,
            email: profile.email,
        };
    }
}

module.exports = (app) => {
    const SERVICE_ENDPOINT = app.get("prefix") + "/authentication";
    const authentication = new AuthenticationService(app);

    authentication.register("jwt", new JWTStrategy());
    authentication.register("local", new LocalStrategy());
    //authentication.register("github", new OAuthStrategy());
    authentication.register("google", new GoogleStrategy());

    app.use(SERVICE_ENDPOINT, authentication);
    app.configure(oauth({}));

    app.service(SERVICE_ENDPOINT).hooks({
        error: {
            all: [async function () {}],
        },
    });
};
