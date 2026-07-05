/** Boilerplate legal / informational copy for the login page (not legal advice). */

export const LOGIN_LEGAL_LAST_UPDATED = 'May 21, 2026'

export function LoginPrivacyPolicyContent() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-on-surface-variant">
      <p>
        <strong className="text-on-surface">Pruning Planner</strong> (the &ldquo;Portal&rdquo;) is operated
        for authorized City of Milwaukee municipal forestry and partner personnel. This notice describes how
        information may be collected and used when you access the Portal.
      </p>
      <p>
        <strong className="text-on-surface">Information we may collect.</strong> When you sign in or request
        access, we may process your name, work email, organization, account identifiers, authentication
        logs, and usage data related to Portal features (for example, map views, reports, or data you
        submit). Tree inventory and operational data displayed in the Portal may include location and
        property-related information maintained by the City or its contractors.
      </p>
      <p>
        <strong className="text-on-surface">How information is used.</strong> Data is used to authenticate
        users, administer access approvals, operate and improve Portal functionality, support municipal
        forestry operations, and comply with applicable law or City policy. The Portal may rely on
        third-party services (including Google Firebase and cloud hosting) that process data on our behalf
        under their respective terms and privacy policies.
      </p>
      <p>
        <strong className="text-on-surface">Retention and disclosure.</strong> Information is retained only
        as long as needed for operational, security, audit, or legal purposes. We do not sell personal
        information. Disclosure may occur to City departments, authorized contractors, law enforcement, or
        others when required by law or necessary to protect the Portal, the City, or the public.
      </p>
      <p>
        <strong className="text-on-surface">Your responsibilities.</strong> Do not enter personal
        information unrelated to municipal business. Protect your credentials and report suspected
        unauthorized access to your administrator promptly.
      </p>
      <p className="text-xs">
        Questions about this notice may be directed to your municipal forestry administrator or the City
        contact listed for this program. This summary does not create contractual rights and may be updated
        from time to time.
      </p>
    </div>
  )
}

export function LoginSecurityTermsContent() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-on-surface-variant">
      <p>
        <strong className="text-on-surface">Authorized use only.</strong> Access to the Portal is limited to
        authorized users with a legitimate municipal or approved partner purpose. You agree not to share
        credentials, attempt unauthorized access, scrape or export data except as permitted, interfere with
        Portal operation, or use the Portal in violation of City policy or applicable law.
      </p>
      <p>
        <strong className="text-on-surface">Security.</strong> You are responsible for safeguarding your
        account and devices. The City may monitor, log, suspend, or revoke access to protect systems and
        data. Report security incidents immediately to your administrator. No system is completely secure;
        use the Portal at your own risk regarding confidentiality of information you transmit.
      </p>
      <p>
        <strong className="text-on-surface">Data accuracy and decisions.</strong> Maps, scores, analytics,
        and recommendations are provided for planning and informational purposes. They may be incomplete,
        estimated, or outdated. Operational decisions remain the responsibility of qualified City personnel;
        do not rely on the Portal as the sole basis for safety-critical or legal determinations.
      </p>
      <p>
        <strong className="text-on-surface">Disclaimer of warranties.</strong> THE PORTAL AND ALL CONTENT
        ARE PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE,&rdquo; WITHOUT WARRANTIES OF ANY KIND,
        WHETHER EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY,
        OR NON-INFRINGEMENT.
      </p>
      <p>
        <strong className="text-on-surface">Limitation of liability.</strong> TO THE MAXIMUM EXTENT
        PERMITTED BY LAW, THE CITY OF MILWAUKEE, ITS DEPARTMENTS, OFFICERS, EMPLOYEES, AGENTS, CONTRACTORS,
        AND DEVELOPERS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
        DAMAGES, OR ANY LOSS OF DATA, PROFITS, OR GOODWILL, ARISING FROM OR RELATED TO USE OF THE PORTAL,
        EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
      </p>
      <p className="text-xs">
        Continued use of the Portal after changes to these terms constitutes acceptance of the updated
        terms where permitted by law. This text is provided for informational purposes and does not
        constitute legal advice.
      </p>
    </div>
  )
}

export function LoginHelpContent() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-on-surface-variant">
      <p>
        <strong className="text-on-surface">Need access?</strong> Use <em>Request access</em> to submit your
        name, organization, and reason for access. An administrator must approve your account before you
        can sign in.
      </p>
      <p>
        <strong className="text-on-surface">Sign-in problems?</strong> Verify your work email and password.
        If you still cannot access the Portal, contact your municipal forestry administrator or IT help
        desk. Self-service password reset may not be available.
      </p>
      <p>
        <strong className="text-on-surface">Using the Portal.</strong> After approval, open the inventory
        map, analytics, and authorized data tools from the main navigation. Do not share export files or
        screenshots containing sensitive operational data outside approved channels.
      </p>
      <p className="text-xs">
        For urgent safety issues related to trees in the public right-of-way, follow established City
        forestry emergency procedures rather than relying solely on this application.
      </p>
    </div>
  )
}

export function LoginForgotPasswordContent() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-on-surface-variant">
      <p>
        Self-service password reset is <strong className="text-on-surface">not configured</strong> for this
        portal yet.
      </p>
      <p>
        To reset your credentials, contact your municipal forestry administrator or IT help desk. Include
        your work email and organization so your request can be verified.
      </p>
      <p className="text-xs">
        If you do not yet have an account, use <em>Request access</em> instead of password reset.
      </p>
    </div>
  )
}
