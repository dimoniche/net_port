import { AbilityBuilder, Ability } from "@casl/ability";
import { isEmpty } from "lodash";

export default function updateAbility(ability, user) {
  const { can, rules } = new AbilityBuilder(Ability);

  if(isEmpty(user) || isEmpty(user.role_name)) {
    can("read", "MainTitle");
  } else {

    switch (user.role_name) {
        case "admin":
        can("manage", "all");
        break;
        case "user":
        can("manage", "Config");
        can("read", "MainTitle");
        break;
        default:
        can("read", "MainTitle");
    }
    }

  ability.update(rules);
}