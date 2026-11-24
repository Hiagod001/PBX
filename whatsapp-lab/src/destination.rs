use super::{DestinationError, Jid, Server};

pub struct Contact<'a> {
    pub jid: &'a Jid,
    pub phone: Option<&'a Jid>,
    pub lid: Option<&'a Jid>,
    pub registered: bool,
    pub lookup_error: bool,
}

// Only recognize a Brazilian mobile alias returned by the authoritative query.
// Never try another number, change the account identity, or accept another DDD.
fn legacy_mobile(phone: &str) -> Option<String> {
    let b = phone.as_bytes();
    if b.len() == 13 && phone.starts_with("55") && b.iter().all(u8::is_ascii_digit)
        && b[4] == b'9' && (b'6'..=b'9').contains(&b[5])
    {
        Some(format!("{}{}", &phone[..4], &phone[5..]))
    } else { None }
}

pub fn same_phone(requested: &str, returned: &str) -> bool {
    requested == returned || legacy_mobile(requested).as_deref() == Some(returned)
        || legacy_mobile(returned).as_deref() == Some(requested)
}

fn identifies(phone: &Jid, candidate: &Jid) -> bool {
    phone.server == Server::Pn && candidate.server == Server::Pn
        && same_phone(&phone.user, &candidate.user)
}

pub fn select_contact(phone: &Jid, contacts: &[Contact<'_>]) -> Result<Jid, DestinationError> {
    let mut matching = contacts.iter().filter(|c|
        identifies(phone,c.jid) || c.phone.is_some_and(|pn|identifies(phone,pn)));
    let contact = matching.next().ok_or(DestinationError::IdentityUnavailable)?;
    if matching.next().is_some() {return Err(DestinationError::IdentityUnavailable);}
    if contact.lookup_error {return Err(DestinationError::LookupUnavailable);}
    if !contact.registered {return Err(DestinationError::NotRecognized);}
    if contact.jid.server == Server::Lid {return Ok(contact.jid.clone());}
    contact.lid.filter(|jid|jid.server == Server::Lid).cloned().ok_or(DestinationError::IdentityUnavailable)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pn(number:&str)->Jid {format!("{number}@s.whatsapp.net").parse().unwrap()}
    fn lid()->Jid {"100000000001@lid".parse().unwrap()}
    #[test]
    fn accepts_only_server_returned_mobile_aliases_with_same_ddd_and_subscriber() {
        let requested=pn("5534999887766");let canonical=pn("553499887766");let peer=lid();
        let contacts=[Contact{jid:&canonical,phone:None,lid:Some(&peer),registered:true,lookup_error:false}];
        assert_eq!(select_contact(&requested,&contacts).unwrap(),peer);
        assert!(same_phone("5534999887766","553499887766"));
        assert!(same_phone("553499887766","5534999887766"));
        assert!(!same_phone("5534999887766","553799887766"));
        assert!(!same_phone("5534999887766","553499887767"));
        assert!(!same_phone("5534931950861","553431950861"));
    }
    #[test]
    fn accepts_lid_primary_response_only_with_matching_phone() {
        let requested=pn("5534999887766");let canonical=pn("553499887766");let peer=lid();
        let contacts=[Contact{jid:&peer,phone:Some(&canonical),lid:None,registered:true,lookup_error:false}];
        assert_eq!(select_contact(&requested,&contacts).unwrap(),peer);
        let unrelated=pn("5537999887766");
        assert!(matches!(select_contact(&unrelated,&contacts),Err(DestinationError::IdentityUnavailable)));
    }
    #[test]
    fn missing_registration_lid_or_ambiguous_results_never_produce_a_dial_target() {
        let phone=pn("5534999887766");let peer=lid();
        let mut contact=Contact{jid:&phone,phone:None,lid:Some(&peer),registered:false,lookup_error:false};
        assert!(matches!(select_contact(&phone,&[contact]),Err(DestinationError::NotRecognized)));
        contact=Contact{jid:&phone,phone:None,lid:None,registered:true,lookup_error:false};
        assert!(matches!(select_contact(&phone,&[contact]),Err(DestinationError::IdentityUnavailable)));
        let contacts=[Contact{jid:&phone,phone:None,lid:Some(&peer),registered:true,lookup_error:false},Contact{jid:&phone,phone:None,lid:Some(&peer),registered:true,lookup_error:false}];
        assert!(matches!(select_contact(&phone,&contacts),Err(DestinationError::IdentityUnavailable)));
        let contacts=[Contact{jid:&phone,phone:None,lid:Some(&peer),registered:true,lookup_error:true}];
        assert!(matches!(select_contact(&phone,&contacts),Err(DestinationError::LookupUnavailable)));
    }
}
